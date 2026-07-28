-- crearUsuario() (src/api/usuarios.ts) da de alta personal en la tabla
-- pública 'usuarios' generando un auth_id con crypto.randomUUID() como
-- marcador de posición, porque todavía no existe un flujo de invitación
-- que cree la cuenta real de Supabase Auth (ver la nota de autenticación
-- al inicio de ese archivo). Si 'usuarios.auth_id' tiene una foreign key
-- hacia auth.users(id), ese INSERT falla siempre con 23503
-- (foreign_key_violation) porque el UUID generado no existe en
-- auth.users — es exactamente el error que se reportó al crear un
-- usuario nuevo desde UsuariosScreen.
--
-- Esta migración busca y elimina esa foreign key (si existe) por su
-- nombre real en pg_constraint, en vez de asumir un nombre fijo — así
-- no falla si el constraint se llama distinto a como se generó
-- originalmente. auth_id sigue siendo NOT NULL: solo se relaja la
-- integridad referencial hacia auth.users mientras no exista el flujo
-- real de alta de credenciales.
--
-- Pendiente explícito: cuando se conecte Supabase Auth (invitación por
-- correo u otro flujo), reinstalar esta foreign key y migrar los
-- auth_id de marcador de posición a los auth.users reales.

do $$
declare
  nombre_constraint text;
begin
  select conname into nombre_constraint
  from pg_constraint
  where conrelid = 'public.usuarios'::regclass
    and contype = 'f'
    and confrelid = 'auth.users'::regclass;

  if nombre_constraint is not null then
    execute format('alter table public.usuarios drop constraint %I', nombre_constraint);
  end if;
end $$;
