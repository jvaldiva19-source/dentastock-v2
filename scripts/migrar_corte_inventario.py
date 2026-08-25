"""Sincroniza el corte fisico de inventario de 'materiales_actualizados.xlsx'
(hoja 'AGOSTO 2026') contra Supabase.

IMPORTANTE sobre el esquema real: la tabla `productos` NO tiene columnas
`cantidad_actual` ni `fecha_caducidad` (a diferencia de lo que asumiria un
mapeo ingenuo columna-a-columna del Excel). El stock vive en
`stock_ubicacion` (por producto + ubicacion) y las caducidades viven en
`lotes` (por lote). Hoy el 100% del stock esta concentrado en una sola
ubicacion (ALMACEN CENTRAL, codigo ALM-CEN), asi que este corte se escribe
ahi sin ambiguedad.

La columna 'requiere_lote' del Excel NO es booleana: para 5 productos
contiene un numero de lote real (anestesias con epinefrina, campos
esteriles), 4 de ellos con fecha de caducidad real en 'CADUCIDAD'. Esos 5
se preservan como registros reales en `lotes`; el resto queda
requiere_lote=False.

Uso:
  python scripts/migrar_corte_inventario.py            # dry-run (no escribe nada)
  python scripts/migrar_corte_inventario.py --dry-run   # idem, explicito
  python scripts/migrar_corte_inventario.py --apply     # aplica los cambios
"""

import argparse
import json
import os
import re
import sys
from datetime import date, datetime
from decimal import ROUND_DOWN, Decimal

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

EXCEL_PATH = "materiales_actualizados.xlsx"
SHEET_NAME = "AGOSTO 2026"
UBICACION_CODIGO = "ALM-CEN"
BACKUP_TABLA_SQL = "productos_respaldo_corte_agosto2026"
BACKUP_DIR = "backups"
BATCH_SIZE = 500

CODIGO_RE = re.compile(r"^DS-\d{4}$")

CONTEO_ESPERADO = 1682
CANTIDAD_TOTAL_ESPERADA = 38062
VALOR_TOTAL_ESPERADO = Decimal("4016609.783")
TOLERANCIA = Decimal("0.01")

# Valores provisionales para productos nuevos que el Excel no puede
# completar (marca y unidad_medida son NOT NULL en productos y el corte
# no trae esas columnas). Confirmado con el usuario para DS-0001.
MARCA_PROVISIONAL = "SIN MARCA"
UNIDAD_MEDIDA_PROVISIONAL = "PIEZA"

load_dotenv(".env.local")
SUPABASE_URL = os.environ["VITE_SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]


def limpiar_precio(valor: float) -> Decimal:
    return Decimal(str(valor)).quantize(Decimal("0.001"), rounding=ROUND_DOWN)


def fetch_all(client, table: str, select: str, page: int = 1000) -> list[dict]:
    rows, start = [], 0
    while True:
        chunk = client.table(table).select(select).range(start, start + page - 1).execute().data
        rows.extend(chunk)
        if len(chunk) < page:
            break
        start += page
    return rows


# ----------------------------------------------------------------------
# 1. Lectura y limpieza (pandas)
# ----------------------------------------------------------------------


def leer_corte(path: str, sheet: str) -> pd.DataFrame:
    df = pd.read_excel(path, sheet_name=sheet)

    df["codigo_barras"] = df["codigo_barras"].astype("string").str.strip()
    validas = df["codigo_barras"].notna() & df["codigo_barras"].str.match(CODIGO_RE, na=False)
    df = df[validas].copy()

    df["concepto"] = df["concepto"].astype("string").str.strip()
    df["cantidad_actual"] = df["cantidad_actual"].astype(int)
    df["stock_minimo"] = df["stock_minimo"].astype(int)
    df["punto_reorden"] = df["punto_reorden"].astype(int)
    df["dias_reorden"] = df["dias_reorden"].astype(int)
    df["precio_sin_iva"] = df["precio_sin_IVA"].astype(float)
    df["precio_con_iva"] = df["precio_con_iva"].astype(float)
    df["activo"] = df["activo"].astype(bool)

    # 'requiere_lote' en el Excel no es booleano: para 5 filas trae un
    # numero de lote real. Se preserva el valor crudo para crear los
    # registros de `lotes`; 'requiere_lote_bool' es la version booleana
    # que sí va a la columna productos.requiere_lote.
    df["numero_lote_raw"] = df["requiere_lote"]
    df["requiere_lote_bool"] = df["numero_lote_raw"].notna()
    df["fecha_caducidad"] = pd.to_datetime(df["CADUCIDAD"], errors="coerce")

    return df.reset_index(drop=True)


# ----------------------------------------------------------------------
# 2. Gatekeeper matematico
# ----------------------------------------------------------------------


def verificar_cuadre(df: pd.DataFrame) -> None:
    conteo = len(df)
    cantidad_total = int(df["cantidad_actual"].sum())
    valor_total = sum(
        (Decimal(str(row.cantidad_actual)) * Decimal(str(row.precio_con_iva)) for row in df.itertuples()),
        Decimal("0"),
    )

    errores = []
    if conteo != CONTEO_ESPERADO:
        errores.append(f"Conteo de registros: {conteo} (esperado {CONTEO_ESPERADO})")
    if cantidad_total != CANTIDAD_TOTAL_ESPERADA:
        errores.append(f"Suma cantidad_actual: {cantidad_total} (esperado {CANTIDAD_TOTAL_ESPERADA})")
    diferencia_valor = abs(valor_total - VALOR_TOTAL_ESPERADO)
    if diferencia_valor > TOLERANCIA:
        errores.append(
            f"Valor total: {valor_total:.3f} (esperado {VALOR_TOTAL_ESPERADO:.3f}, "
            f"diferencia {diferencia_valor:.3f} > tolerancia {TOLERANCIA})"
        )

    print("--- Gatekeeper matematico ---")
    print(f"  Conteo de registros validos : {conteo} (esperado {CONTEO_ESPERADO})")
    print(f"  Suma cantidad_actual        : {cantidad_total} (esperado {CANTIDAD_TOTAL_ESPERADA})")
    print(f"  Valor total (cant*con_iva)  : {valor_total:.3f} (esperado {VALOR_TOTAL_ESPERADO:.3f})")

    if errores:
        print("\nABORTADO: discrepancias fuera de tolerancia:")
        for e in errores:
            print(f"  - {e}")
        sys.exit(1)

    print("  OK: los 3 controles cuadran dentro de la tolerancia.\n")


# ----------------------------------------------------------------------
# 3. Reporte de cuadre (diagnostico contra el estado actual de Supabase)
# ----------------------------------------------------------------------


def construir_reporte(client, df: pd.DataFrame) -> dict:
    productos_db = fetch_all(client, "productos", "id,codigo_barras,activo")
    codigos_db = {p["codigo_barras"]: p for p in productos_db}
    codigos_excel = set(df["codigo_barras"])

    codigos_nuevos = sorted(codigos_excel - set(codigos_db))
    codigos_desactivar = sorted(c for c in (set(codigos_db) - codigos_excel) if codigos_db[c]["activo"])

    lotes_especiales = df[df["requiere_lote_bool"]][
        ["codigo_barras", "concepto", "numero_lote_raw", "fecha_caducidad", "cantidad_actual"]
    ].to_dict("records")

    ubicacion = client.table("ubicaciones").select("id,nombre,codigo").eq("codigo", UBICACION_CODIGO).execute().data
    if not ubicacion:
        sys.exit(f"ABORTADO: no se encontro la ubicacion '{UBICACION_CODIGO}' en Supabase.")

    return {
        "codigos_nuevos": codigos_nuevos,
        "codigos_desactivar": codigos_desactivar,
        "lotes_especiales": lotes_especiales,
        "ubicacion": ubicacion[0],
        "codigos_db": codigos_db,
    }


def imprimir_reporte(reporte: dict) -> None:
    print("--- Reporte de cuadre ---")
    print(f"  Ubicacion destino del corte: {reporte['ubicacion']['nombre']} ({reporte['ubicacion']['codigo']})\n")

    print(f"  Productos nuevos a crear ({len(reporte['codigos_nuevos'])}):")
    for c in reporte["codigos_nuevos"]:
        print(f"    + {c}  (marca='{MARCA_PROVISIONAL}', unidad_medida='{UNIDAD_MEDIDA_PROVISIONAL}' provisionales)")

    print(f"\n  Productos a desactivar, no forman parte de este corte ({len(reporte['codigos_desactivar'])}):")
    for i in range(0, len(reporte["codigos_desactivar"]), 10):
        print("    " + ", ".join(reporte["codigos_desactivar"][i : i + 10]))

    print(f"\n  Lotes reales a preservar en 'lotes' ({len(reporte['lotes_especiales'])}):")
    for lote in reporte["lotes_especiales"]:
        caducidad = lote["fecha_caducidad"]
        caducidad_str = caducidad.date().isoformat() if pd.notna(caducidad) else "sin fecha"
        print(
            f"    {lote['codigo_barras']} {lote['concepto']!r} -> lote '{lote['numero_lote_raw']}', "
            f"{lote['cantidad_actual']} pzas, caduca {caducidad_str}"
        )
    print()


# ----------------------------------------------------------------------
# 4. Respaldo
# ----------------------------------------------------------------------


def verificar_backup_sql(client) -> None:
    try:
        client.table(BACKUP_TABLA_SQL).select("id").limit(1).execute()
    except Exception:
        sql = (
            f"create table if not exists public.{BACKUP_TABLA_SQL} as\n"
            f"select * from public.productos;"
        )
        sys.exit(
            "ABORTADO: falta la tabla de respaldo en Supabase.\n"
            f"Ejecuta esto una vez en el SQL Editor de Supabase antes de --apply:\n\n{sql}\n"
        )


def respaldo_local(client) -> str:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    carpeta = os.path.join(BACKUP_DIR, f"corte_agosto2026_{ts}")
    os.makedirs(carpeta, exist_ok=True)

    for tabla in ["productos", "stock_ubicacion", "lotes"]:
        datos = fetch_all(client, tabla, "*")
        with open(os.path.join(carpeta, f"{tabla}.json"), "w", encoding="utf-8") as f:
            json.dump(datos, f, ensure_ascii=False, default=str)
        print(f"  Respaldo local: {tabla} ({len(datos)} filas) -> {carpeta}/{tabla}.json")

    return carpeta


# ----------------------------------------------------------------------
# 5. Carga
# ----------------------------------------------------------------------


def aplicar_cambios(client, df: pd.DataFrame, reporte: dict) -> None:
    verificar_backup_sql(client)
    print("--- Respaldo local previo a la escritura ---")
    respaldo_local(client)

    codigos_nuevos = set(reporte["codigos_nuevos"])

    # marca y unidad_medida son NOT NULL sin default: Postgres construye
    # la fila candidata del INSERT (incluyendo estas columnas) ANTES de
    # resolver ON CONFLICT, asi que un upsert que las omita falla incluso
    # para filas que en realidad solo iban a actualizarse. Hay que
    # reenviar su valor actual (sin cambiarlo) para los codigos existentes.
    marca_y_unidad_actual = {
        p["codigo_barras"]: (p["marca"], p["unidad_medida"])
        for p in fetch_all(client, "productos", "codigo_barras,marca,unidad_medida")
    }

    # --- productos: upsert por codigo_barras, en dos lotes porque los
    # productos nuevos necesitan valores provisionales para esas mismas
    # columnas (el Excel no las trae). ---
    existentes, nuevos = [], []
    for row in df.itertuples():
        payload = {
            "codigo_barras": row.codigo_barras,
            "concepto": row.concepto,
            "precio_sin_iva": str(limpiar_precio(row.precio_sin_iva)),
            "precio_con_iva": str(limpiar_precio(row.precio_con_iva)),
            "stock_minimo": row.stock_minimo,
            "punto_reorden": row.punto_reorden,
            "dias_reorden": row.dias_reorden,
            "requiere_lote": bool(row.requiere_lote_bool),
            "activo": True,
        }
        if row.codigo_barras in codigos_nuevos:
            payload["marca"] = MARCA_PROVISIONAL
            payload["unidad_medida"] = UNIDAD_MEDIDA_PROVISIONAL
            nuevos.append(payload)
        else:
            marca, unidad_medida = marca_y_unidad_actual[row.codigo_barras]
            payload["marca"] = marca
            payload["unidad_medida"] = unidad_medida
            existentes.append(payload)

    print("\n--- Cargando productos ---")
    for lote_nombre, lote in [("existentes", existentes), ("nuevos", nuevos)]:
        for i in range(0, len(lote), BATCH_SIZE):
            trozo = lote[i : i + BATCH_SIZE]
            if not trozo:
                continue
            client.table("productos").upsert(trozo, on_conflict="codigo_barras").execute()
            print(f"  Upsert productos ({lote_nombre}) {i + len(trozo)}/{len(lote)}")

    # --- stock_ubicacion: cantidad_actual como nuevo saldo base, sin
    # generar movimientos, tal como se pidio explicitamente. Upsert por
    # lotes (producto_id, ubicacion_id) en vez de una llamada HTTP por
    # fila: 1,682 updates uno por uno es lento y expuesto a timeouts de
    # red transitorios (como paso en el primer intento de --apply).
    productos_db = {p["codigo_barras"]: p["id"] for p in fetch_all(client, "productos", "id,codigo_barras")}
    ubicacion_id = reporte["ubicacion"]["id"]

    stock_payload = [
        {
            "producto_id": productos_db[row.codigo_barras],
            "ubicacion_id": ubicacion_id,
            "cantidad_actual": row.cantidad_actual,
        }
        for row in df.itertuples()
    ]

    print(f"\n--- Cargando stock_ubicacion ({UBICACION_CODIGO}) ---")
    for i in range(0, len(stock_payload), BATCH_SIZE):
        trozo = stock_payload[i : i + BATCH_SIZE]
        client.table("stock_ubicacion").upsert(trozo, on_conflict="producto_id,ubicacion_id").execute()
        print(f"  Upsert stock_ubicacion {i + len(trozo)}/{len(stock_payload)}")

    # --- lotes: preservar numero de lote + caducidad real, idempotente
    # (no duplica si ya existe el mismo producto_id + numero_lote). ---
    print("\n--- Preservando lotes reales (caducidad) ---")
    lotes_existentes = fetch_all(client, "lotes", "producto_id,numero_lote")
    claves_existentes = {(l["producto_id"], l["numero_lote"]) for l in lotes_existentes}

    for lote in reporte["lotes_especiales"]:
        producto_id = productos_db[lote["codigo_barras"]]
        numero_lote = str(lote["numero_lote_raw"])
        if (producto_id, numero_lote) in claves_existentes:
            print(f"  {lote['codigo_barras']}: lote '{numero_lote}' ya existe, se omite.")
            continue

        fecha_caducidad = lote["fecha_caducidad"]
        costo_unitario = df.loc[df["codigo_barras"] == lote["codigo_barras"], "precio_sin_iva"].iloc[0]

        client.table("lotes").insert(
            {
                "producto_id": producto_id,
                "numero_lote": numero_lote,
                "fecha_entrada": date.today().isoformat(),
                "fecha_caducidad": fecha_caducidad.date().isoformat() if pd.notna(fecha_caducidad) else None,
                "costo_unitario": str(limpiar_precio(costo_unitario)),
                # La tabla 'lotes' real en Supabase no tiene columna
                # cantidad_actual (la migracion que la agregaba nunca se
                # aplico en este proyecto) - solo cantidad_inicial.
                "cantidad_inicial": lote["cantidad_actual"],
                "estado": "ACTIVO",
            }
        ).execute()
        print(f"  {lote['codigo_barras']}: creado lote '{numero_lote}'.")

    # --- desactivar productos que no forman parte de este corte ---
    print("\n--- Desactivando productos fuera de este corte ---")
    for codigo in reporte["codigos_desactivar"]:
        client.table("productos").update({"activo": False}).eq("codigo_barras", codigo).execute()
    print(f"  Desactivados {len(reporte['codigos_desactivar'])} productos.")

    # --- reconciliacion final ---
    print("\n--- Reconciliacion final ---")
    stock_final = fetch_all(client, "stock_ubicacion", "producto_id,ubicacion_id,cantidad_actual")
    stock_final = [s for s in stock_final if s["ubicacion_id"] == ubicacion_id]
    productos_final = {p["id"]: p for p in fetch_all(client, "productos", "id,codigo_barras,precio_con_iva")}

    codigos_corte = set(df["codigo_barras"])
    cantidad_final = 0
    valor_final = Decimal("0")
    for s in stock_final:
        p = productos_final.get(s["producto_id"])
        if p is None or p["codigo_barras"] not in codigos_corte:
            continue
        cantidad_final += s["cantidad_actual"]
        valor_final += Decimal(str(s["cantidad_actual"])) * Decimal(str(p["precio_con_iva"]))

    print(f"  Suma cantidad_actual en Supabase (solo codigos del corte): {cantidad_final}")
    print(f"  Valor total en Supabase (solo codigos del corte)         : {valor_final:.3f}")
    print(f"  Esperado                                                  : {CANTIDAD_TOTAL_ESPERADA} / {VALOR_TOTAL_ESPERADO:.3f}")


# ----------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Aplica los cambios a Supabase.")
    parser.add_argument("--dry-run", action="store_true", help="Solo valida y reporta (default).")
    args = parser.parse_args()

    if not os.path.exists(EXCEL_PATH):
        sys.exit(f"No se encontro '{EXCEL_PATH}' en el directorio actual.")

    df = leer_corte(EXCEL_PATH, SHEET_NAME)
    verificar_cuadre(df)

    client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    reporte = construir_reporte(client, df)
    imprimir_reporte(reporte)

    if args.apply:
        aplicar_cambios(client, df, reporte)
        print("\nMigracion aplicada.")
    else:
        print("Modo dry-run: no se escribio nada en Supabase. Ejecuta con --apply para aplicar los cambios.")


if __name__ == "__main__":
    main()
