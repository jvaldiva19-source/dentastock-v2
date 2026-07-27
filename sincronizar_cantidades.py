"""Sincroniza stock_ubicacion.cantidad_actual con las cantidades reales de
INVENTARIO PRODUCTOS Y PRECIOS CANTIDADES.csv (fuente de verdad del inventario fisico).

Solo actualiza las filas cuya cantidad difiere; deja intacto todo lo demas."""

import csv
import os

from dotenv import load_dotenv
from supabase import create_client

CSV_PATH = "INVENTARIO PRODUCTOS Y PRECIOS CANTIDADES.csv"

load_dotenv(".env.local")
client = create_client(os.environ["VITE_SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])


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


cantidad_csv_por_codigo = {}
with open(CSV_PATH, encoding="latin1", newline="") as f:
    reader = csv.DictReader(f)
    for fila in reader:
        cantidad_csv_por_codigo[fila["codigo_barras"].strip()] = int(fila["cantidad_actual"])

productos = fetch_all_ordered("productos", "id,codigo_barras", "codigo_barras")
stock = fetch_all_ordered("stock_ubicacion", "id,producto_id,cantidad_actual", "producto_id")

cb_por_producto_id = {p["id"]: p["codigo_barras"] for p in productos}

por_actualizar = []
for s in stock:
    cb = cb_por_producto_id[s["producto_id"]]
    cantidad_real = cantidad_csv_por_codigo.get(cb)
    if cantidad_real is not None and cantidad_real != s["cantidad_actual"]:
        por_actualizar.append(
            {
                "stock_ubicacion_id": s["id"],
                "codigo_barras": cb,
                "cantidad_anterior": s["cantidad_actual"],
                "cantidad_nueva": cantidad_real,
            }
        )

print(f"Filas a actualizar: {len(por_actualizar)} de {len(stock)}.\n")

for cambio in por_actualizar:
    client.table("stock_ubicacion").update({"cantidad_actual": cambio["cantidad_nueva"]}).eq(
        "id", cambio["stock_ubicacion_id"]
    ).execute()
    print(
        f"  {cambio['codigo_barras']}: {cambio['cantidad_anterior']} -> {cambio['cantidad_nueva']}"
    )

print(f"\nSincronizacion completada: {len(por_actualizar)} filas actualizadas.")
