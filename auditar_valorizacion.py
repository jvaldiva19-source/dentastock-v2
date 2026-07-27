"""Audita INVENTARIO PRODUCTOS Y PRECIOS CANTIDADES.csv contra el estado real en Supabase
para explicar la diferencia entre el total calculado y la cifra objetivo del usuario."""

import csv
import os
from collections import Counter
from decimal import ROUND_DOWN, Decimal

from dotenv import load_dotenv
from supabase import create_client

CSV_PATH = "INVENTARIO PRODUCTOS Y PRECIOS CANTIDADES.csv"
OBJETIVO = Decimal("3723211.676")

load_dotenv(".env.local")
client = create_client(os.environ["VITE_SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])


def limpiar_precio(valor: str) -> Decimal:
    valor = (valor or "").strip().replace(",", "")
    if not valor:
        return Decimal("0.000")
    return Decimal(valor).quantize(Decimal("0.001"), rounding=ROUND_DOWN)


def fetch_all_ordered(table, select, order_col, page=1000):
    rows, start = [], 0
    while True:
        resp = client.table(table).select(select).order(order_col).range(start, start + page - 1).execute()
        chunk = resp.data
        rows.extend(chunk)
        if len(chunk) < page:
            break
        start += page
    return rows


# --- 1. Leer el CSV local ---
csv_por_codigo = {}
with open(CSV_PATH, encoding="latin1", newline="") as f:
    reader = csv.DictReader(f)
    for fila in reader:
        cb = fila["codigo_barras"].strip()
        csv_por_codigo[cb] = {
            "concepto": fila["concepto"].strip(),
            "cantidad_actual": int(fila["cantidad_actual"]),
            "precio_sin_iva": limpiar_precio(fila["precio_sin_iva"]),
            "precio_con_iva": limpiar_precio(fila["precio_con_iva"]),
            "activo": fila["activo"].strip().upper() == "TRUE",
        }

print(f"CSV: {len(csv_por_codigo)} filas leidas de '{CSV_PATH}'.\n")

# --- 2. Estado real en Supabase (productos + stock_ubicacion, join por id) ---
productos = fetch_all_ordered("productos", "id,codigo_barras,precio_sin_iva,precio_con_iva,activo", "codigo_barras")
stock = fetch_all_ordered("stock_ubicacion", "producto_id,cantidad_actual,ubicacion_id", "producto_id")

prod_por_id = {p["id"]: p for p in productos}
db_por_codigo = {}
for s in stock:
    p = prod_por_id[s["producto_id"]]
    cb = p["codigo_barras"]
    db_por_codigo.setdefault(cb, {"cantidad_actual": 0})
    db_por_codigo[cb]["cantidad_actual"] += s["cantidad_actual"]
    db_por_codigo[cb]["precio_sin_iva"] = Decimal(str(p["precio_sin_iva"]))
    db_por_codigo[cb]["precio_con_iva"] = Decimal(str(p["precio_con_iva"]))
    db_por_codigo[cb]["activo"] = p["activo"]

ubicaciones_usadas = Counter(s["ubicacion_id"] for s in stock)
print(f"stock_ubicacion: {len(stock)} filas, en {len(ubicaciones_usadas)} ubicacion(es) distinta(s).\n")

# --- 3. Comparacion fila por fila ---
codigos_csv = set(csv_por_codigo)
codigos_db = set(db_por_codigo)

solo_en_csv = codigos_csv - codigos_db
solo_en_db = codigos_db - codigos_csv
comunes = codigos_csv & codigos_db

print(f"Codigos solo en el CSV (no tienen stock en Supabase): {len(solo_en_csv)}")
print(f"Codigos solo en Supabase (no estan en este CSV): {len(solo_en_db)}")
print(f"Codigos en ambos: {len(comunes)}\n")

diff_cantidad = []
diff_precio_sin = []
diff_precio_con = []
for cb in sorted(comunes):
    c = csv_por_codigo[cb]
    d = db_por_codigo[cb]
    if c["cantidad_actual"] != d["cantidad_actual"]:
        diff_cantidad.append((cb, c["cantidad_actual"], d["cantidad_actual"]))
    if c["precio_sin_iva"] != d["precio_sin_iva"]:
        diff_precio_sin.append((cb, c["precio_sin_iva"], d["precio_sin_iva"]))
    if c["precio_con_iva"] != d["precio_con_iva"]:
        diff_precio_con.append((cb, c["precio_con_iva"], d["precio_con_iva"]))

print(f"Filas con cantidad_actual distinta (CSV vs Supabase): {len(diff_cantidad)}")
for x in diff_cantidad[:10]:
    print(" ", x)
print(f"\nFilas con precio_sin_iva distinto (CSV vs Supabase): {len(diff_precio_sin)}")
for x in diff_precio_sin[:10]:
    print(" ", x)
print(f"\nFilas con precio_con_iva distinto (CSV vs Supabase): {len(diff_precio_con)}")
for x in diff_precio_con[:10]:
    print(" ", x)

# --- 4. Candidatos de totales ---
def total(fuente, campo_precio, solo_activos=False):
    t = Decimal("0.000")
    for cb, datos in fuente.items():
        if solo_activos and not datos.get("activo", True):
            continue
        t += Decimal(str(datos["cantidad_actual"])) * datos[campo_precio]
    return t.quantize(Decimal("0.001"), rounding=ROUND_DOWN)


print("\n--- Totales candidatos ---")
candidatos = {
    "CSV: cantidad_csv x precio_sin_iva_csv (todos)": total(csv_por_codigo, "precio_sin_iva"),
    "CSV: cantidad_csv x precio_con_iva_csv (todos)": total(csv_por_codigo, "precio_con_iva"),
    "CSV: cantidad_csv x precio_sin_iva_csv (solo activo=TRUE)": total(csv_por_codigo, "precio_sin_iva", solo_activos=True),
    "CSV: cantidad_csv x precio_con_iva_csv (solo activo=TRUE)": total(csv_por_codigo, "precio_con_iva", solo_activos=True),
    "DB: cantidad_db x precio_sin_iva_db (todos)": total(db_por_codigo, "precio_sin_iva"),
    "DB: cantidad_db x precio_con_iva_db (todos)": total(db_por_codigo, "precio_con_iva"),
    "DB: cantidad_db x precio_sin_iva_db (solo activo=TRUE)": total(db_por_codigo, "precio_sin_iva", solo_activos=True),
    "DB: cantidad_db x precio_con_iva_db (solo activo=TRUE)": total(db_por_codigo, "precio_con_iva", solo_activos=True),
}
for nombre, valor in candidatos.items():
    delta = valor - OBJETIVO
    print(f"  {nombre}: {valor:>15.3f}   (diferencia vs objetivo: {delta:+.3f})")

print(f"\nObjetivo del usuario: {OBJETIVO:.3f}")

# --- 5. Filas en 0 o excluidas ---
en_cero = [cb for cb, d in csv_por_codigo.items() if d["precio_sin_iva"] == 0 or d["cantidad_actual"] == 0]
inactivos = [cb for cb, d in csv_por_codigo.items() if not d["activo"]]
print(f"\nFilas del CSV con precio_sin_iva=0 o cantidad_actual=0: {len(en_cero)}")
print(f"Filas del CSV con activo=FALSE: {len(inactivos)}")
