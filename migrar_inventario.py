"""Sincroniza INVENTARIO PRODUCTOS Y PRECIOS.csv con la tabla productos en Supabase."""

import csv
import os
import sys
from decimal import Decimal, ROUND_DOWN

from dotenv import load_dotenv
from supabase import create_client

CSV_PATH = "INVENTARIO PRODUCTOS Y PRECIOS.csv"
BATCH_SIZE = 500

load_dotenv(".env.local")

SUPABASE_URL = os.environ["VITE_SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]


def limpiar_precio(valor: str) -> Decimal:
    valor = (valor or "").strip().replace(",", "")
    if not valor:
        return Decimal("0.000")
    return Decimal(valor).quantize(Decimal("0.001"), rounding=ROUND_DOWN)


def leer_productos(csv_path: str) -> list[dict]:
    productos = []
    with open(csv_path, encoding="latin1", newline="") as f:
        reader = csv.DictReader(f)
        for fila in reader:
            productos.append(
                {
                    "codigo_barras": fila["codigo_barras"].strip(),
                    "concepto": fila["concepto"].strip(),
                    "marca": fila["marca"].strip(),
                    "unidad_medida": fila["unidad_medida"],
                    "precio_sin_iva": str(limpiar_precio(fila["precio_sin_iva"])),
                    "precio_con_iva": str(limpiar_precio(fila["precio_con_iva"])),
                    "stock_minimo": int(fila["stock_minimo"]),
                    "punto_reorden": int(fila["punto_reorden"]),
                    "dias_reorden": int(fila["dias_reorden"]),
                    "requiere_lote": fila["requiere_lote"].strip().upper() == "TRUE",
                    "activo": fila["activo"].strip().upper() == "TRUE",
                }
            )
    return productos


def main() -> None:
    client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    productos = leer_productos(CSV_PATH)
    print(f"Leidos {len(productos)} productos de '{CSV_PATH}'.")

    for inicio in range(0, len(productos), BATCH_SIZE):
        lote = productos[inicio : inicio + BATCH_SIZE]
        client.table("productos").upsert(lote, on_conflict="codigo_barras").execute()
        print(f"  Upsert lote {inicio // BATCH_SIZE + 1}: {len(lote)} filas ({inicio + len(lote)}/{len(productos)}).")

    print("Carga a Supabase completada.\n")

    valorizacion = client.table("v_valorizacion_inventario").select("valor_total").execute().data

    IVA = Decimal("1.16")
    valor_total_bruto = sum((Decimal(str(fila["valor_total"] or 0)) for fila in valorizacion), Decimal("0.000"))
    valor_total_neto = valor_total_bruto / IVA

    valor_total_neto = valor_total_neto.quantize(Decimal("0.001"), rounding=ROUND_DOWN)
    valor_total_bruto = valor_total_bruto.quantize(Decimal("0.001"), rounding=ROUND_DOWN)

    print("Conciliacion v_valorizacion_inventario (cantidad_actual x precio de productos):")
    print(f"  Valor Total Neto:  {valor_total_neto:.3f}")
    print(f"  Valor Total Bruto: {valor_total_bruto:.3f}")


if __name__ == "__main__":
    if not os.path.exists(CSV_PATH):
        sys.exit(f"No se encontro '{CSV_PATH}' en el directorio actual.")
    main()
