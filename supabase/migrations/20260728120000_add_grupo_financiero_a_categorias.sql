-- Clasificación financiera de categorías, requerida por el Reporte de
-- Finanzas (public/templates/plantilla_finanzas.xlsx): el bloque de
-- Existencia Inicial desglosa el total en MATERIAL DENTAL vs
-- MAT. LIMPIEZA. Todas las categorías existentes quedan clasificadas
-- por defecto como MATERIAL_DENTAL (el grupo mayoritario) — la
-- clasificación real se ajusta manualmente desde la nueva sección
-- "Clasificación financiera" de CatalogoScreen.

create type grupo_financiero_categoria as enum ('MATERIAL_DENTAL', 'MATERIAL_LIMPIEZA');

alter table categorias
  add column grupo_financiero grupo_financiero_categoria not null default 'MATERIAL_DENTAL';
