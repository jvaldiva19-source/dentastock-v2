// supabase/functions/crear-usuario/index.ts
//
// Edge Function (Deno) — ÚNICO lugar del proyecto donde se usa la
// Service Role Key de Supabase. Existe porque crear una cuenta real de
// Supabase Auth para un nuevo empleado requiere `auth.admin.createUser()`,
// y ese método SOLO está disponible con la Service Role Key — una clave
// que nunca debe llegar al navegador (bypassa RLS por completo). Por la
// misma razón se descartó `supabase.auth.signUp()` desde el cliente: al
// llamarse con una sesión de ADMIN ya activa, signUp() puede
// reemplazar esa sesión por la del usuario recién creado, cerrando la
// sesión del administrador sin aviso.
//
// Flujo:
//   1. Verifica que quien llama tiene una sesión válida (Authorization
//      header) y que su rol en 'usuarios' es ADMIN — el motor
//      es la garantía real (RLS), pero aquí se revisa explícitamente
//      porque esta función usa un cliente con privilegios totales.
//   2. Crea la cuenta de Auth (auth.admin.createUser) con el correo y
//      contraseña capturados en el formulario.
//   3. Inserta el perfil en 'public.usuarios' con auth_id = el id real
//      que acaba de devolver Supabase Auth.
//   4. Si el paso 3 falla (ej. nombre_usuario duplicado), revierte el
//      paso 2 (auth.admin.deleteUser) para no dejar una cuenta de Auth
//      huérfana sin fila correspondiente en 'usuarios'.
//
// Despliegue (no se puede hacer desde este entorno — requiere tu CLI
// autenticado contra el proyecto real):
//   supabase functions deploy crear-usuario
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los
// inyecta Supabase automáticamente en el entorno de toda Edge Function
// — no hace falta configurarlos a mano con `supabase secrets set`.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function respuestaError(status: number, mensaje: string) {
  return new Response(JSON.stringify({ error: mensaje }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return respuestaError(405, 'Método no permitido.')
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return respuestaError(401, 'Falta el encabezado de autorización.')
    }

    // Cliente "como quien llama" — solo para confirmar identidad y rol,
    // nunca se usa para escribir.
    const clienteLlamador = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: sesion, error: errorSesion } = await clienteLlamador.auth.getUser()
    if (errorSesion || !sesion?.user) {
      return respuestaError(401, 'Sesión inválida o expirada.')
    }

    // Cliente con privilegios totales — vive únicamente dentro de esta
    // función, jamás se expone al navegador.
    const clienteAdmin = createClient(supabaseUrl, serviceRoleKey)

    const { data: perfilLlamador, error: errorPerfil } = await clienteAdmin
      .from('usuarios')
      .select('rol')
      .eq('auth_id', sesion.user.id)
      .single()

    if (errorPerfil || !perfilLlamador || perfilLlamador.rol !== 'ADMIN') {
      return respuestaError(403, 'Tu usuario no tiene permisos para crear nuevos usuarios.')
    }

    const body = await req.json()
    const {
      nombre_completo: nombreCompleto,
      nombre_usuario: nombreUsuario,
      email,
      password,
      rol,
      ubicacion_id: ubicacionId,
      activo,
    } = body ?? {}

    if (!nombreCompleto || !nombreUsuario || !email || !password || !rol) {
      return respuestaError(400, 'Faltan campos obligatorios para crear el usuario.')
    }
    if (rol !== 'ADMIN' && rol !== 'ENCARGADO_FARMACIA') {
      return respuestaError(400, 'Rol inválido.')
    }
    if (rol === 'ENCARGADO_FARMACIA' && !ubicacionId) {
      return respuestaError(400, 'El encargado de farmacia requiere una ubicación asignada.')
    }
    if (typeof password !== 'string' || password.length < 8) {
      return respuestaError(400, 'La contraseña debe tener al menos 8 caracteres.')
    }

    const { data: cuentaAuth, error: errorAuth } = await clienteAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre_completo: nombreCompleto },
    })

    if (errorAuth || !cuentaAuth?.user) {
      const yaExiste = (errorAuth?.message ?? '').toLowerCase().includes('already')
      return respuestaError(
        yaExiste ? 409 : 400,
        yaExiste
          ? 'Ya existe una cuenta de autenticación con ese correo electrónico.'
          : (errorAuth?.message ?? 'No se pudo crear la cuenta de autenticación.'),
      )
    }

    const { data: usuario, error: errorInsert } = await clienteAdmin
      .from('usuarios')
      .insert({
        auth_id: cuentaAuth.user.id,
        nombre_completo: nombreCompleto,
        nombre_usuario: String(nombreUsuario).trim().toLowerCase(),
        email,
        rol,
        ubicacion_id: rol === 'ENCARGADO_FARMACIA' ? ubicacionId : null,
        activo: activo ?? true,
      })
      .select()
      .single()

    if (errorInsert || !usuario) {
      // Revierte la cuenta de Auth recién creada — sin esto quedaría una
      // cuenta capaz de iniciar sesión pero sin fila en 'usuarios', lo
      // que rompería cualquier consulta que la use (rol, ubicación, etc.).
      await clienteAdmin.auth.admin.deleteUser(cuentaAuth.user.id)

      const duplicado = errorInsert?.code === '23505'
      return respuestaError(
        duplicado ? 409 : 500,
        duplicado
          ? 'Ya existe un usuario registrado con ese nombre de usuario.'
          : 'No se pudo guardar el perfil del usuario. Se revirtió la cuenta de autenticación creada.',
      )
    }

    return new Response(JSON.stringify({ usuario }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[crear-usuario] excepción:', err)
    return respuestaError(500, 'Error inesperado al crear el usuario.')
  }
})
