/**
 * DentaStock v2 — Tipos de la base de datos
 *
 * ARCHIVO SIMULADO DE ALTA FIDELIDAD.
 * Este archivo replica exactamente la estructura que produce el comando:
 *
 *   supabase gen types typescript --project-id <id> --schema public > src/types/database.types.ts
 *
 * Se generó a mano porque el CLI todavía no se ha ejecutado contra el
 * proyecto real, pero su contenido es consistente con el esquema aprobado
 * en docs/arquitectura.md. Cuando se ejecute el CLI por primera vez, ESTE
 * ARCHIVO DEBE SER REEMPLAZADO por la salida real del comando — no debe
 * mantenerse a mano una vez que exista la fuente autogenerada.
 *
 * No editar los tipos de Tables/Views/Enums manualmente en un proyecto real:
 * cualquier cambio de esquema se hace vía migración SQL y luego se regenera
 * este archivo completo.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      categorias: {
        Row: {
          id: string
          nombre: string
          descripcion: string | null
          requiere_cadena_frio: boolean
          grupo_financiero: Database['public']['Enums']['grupo_financiero_categoria']
          created_at: string
        }
        Insert: {
          id?: string
          nombre: string
          descripcion?: string | null
          requiere_cadena_frio?: boolean
          grupo_financiero?: Database['public']['Enums']['grupo_financiero_categoria']
          created_at?: string
        }
        Update: {
          id?: string
          nombre?: string
          descripcion?: string | null
          requiere_cadena_frio?: boolean
          grupo_financiero?: Database['public']['Enums']['grupo_financiero_categoria']
          created_at?: string
        }
        Relationships: []
      }
      ubicaciones: {
        Row: {
          id: string
          codigo: string
          nombre: string
          tipo: string
          es_destino_final: boolean
          activo: boolean
          created_at: string
        }
        Insert: {
          id?: string
          codigo: string
          nombre: string
          tipo: string
          es_destino_final?: boolean
          activo?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          codigo?: string
          nombre?: string
          tipo?: string
          es_destino_final?: boolean
          activo?: boolean
          created_at?: string
        }
        Relationships: []
      }
      proveedores: {
        Row: {
          id: string
          nombre: string
          rfc: string | null
          contacto: string | null
          telefono: string | null
          email: string | null
          direccion: string | null
          activo: boolean
          notas: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          nombre: string
          rfc?: string | null
          contacto?: string | null
          telefono?: string | null
          email?: string | null
          direccion?: string | null
          activo?: boolean
          notas?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          nombre?: string
          rfc?: string | null
          contacto?: string | null
          telefono?: string | null
          email?: string | null
          direccion?: string | null
          activo?: boolean
          notas?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      productos: {
        Row: {
          id: string
          codigo_barras: string
          concepto: string
          descripcion: string | null
          categoria_id: string | null
          unidad_medida: Database['public']['Enums']['unidad_medida']
          precio_sin_iva: number | null
          precio_con_iva: number | null
          stock_minimo: number
          punto_reorden: number
          dias_reorden: number | null
          requiere_lote: boolean
          activo: boolean
          imagen_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          codigo_barras: string
          concepto: string
          descripcion?: string | null
          categoria_id?: string | null
          unidad_medida?: Database['public']['Enums']['unidad_medida']
          precio_sin_iva?: number | null
          precio_con_iva?: number | null
          stock_minimo?: number
          punto_reorden?: number
          dias_reorden?: number | null
          requiere_lote?: boolean
          activo?: boolean
          imagen_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          codigo_barras?: string
          concepto?: string
          descripcion?: string | null
          categoria_id?: string | null
          unidad_medida?: Database['public']['Enums']['unidad_medida']
          precio_sin_iva?: number | null
          precio_con_iva?: number | null
          stock_minimo?: number
          punto_reorden?: number
          dias_reorden?: number | null
          requiere_lote?: boolean
          activo?: boolean
          imagen_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'productos_categoria_id_fkey'
            columns: ['categoria_id']
            isOneToOne: false
            referencedRelation: 'categorias'
            referencedColumns: ['id']
          },
        ]
      }
      usuarios: {
        Row: {
          id: string
          auth_id: string
          nombre_usuario: string
          nombre_completo: string | null
          email: string | null
          rol: Database['public']['Enums']['rol_usuario']
          ubicacion_id: string | null
          activo: boolean
          ultimo_acceso: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          auth_id: string
          nombre_usuario: string
          nombre_completo?: string | null
          email?: string | null
          rol: Database['public']['Enums']['rol_usuario']
          ubicacion_id?: string | null
          activo?: boolean
          ultimo_acceso?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          auth_id?: string
          nombre_usuario?: string
          nombre_completo?: string | null
          email?: string | null
          rol?: Database['public']['Enums']['rol_usuario']
          ubicacion_id?: string | null
          activo?: boolean
          ultimo_acceso?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'usuarios_ubicacion_id_fkey'
            columns: ['ubicacion_id']
            isOneToOne: false
            referencedRelation: 'ubicaciones'
            referencedColumns: ['id']
          },
        ]
      }
      lotes: {
        Row: {
          id: string
          producto_id: string
          proveedor_id: string | null
          numero_lote: string
          numero_factura: string | null
          fecha_entrada: string
          fecha_caducidad: string | null
          costo_unitario: number | null
          cantidad_inicial: number
          cantidad_actual: number
          estado: Database['public']['Enums']['estado_lote']
          observaciones: string | null
          registrado_por: string | null
          created_at: string
        }
        Insert: {
          id?: string
          producto_id: string
          proveedor_id?: string | null
          numero_lote: string
          numero_factura?: string | null
          fecha_entrada?: string
          fecha_caducidad?: string | null
          costo_unitario?: number | null
          cantidad_inicial: number
          cantidad_actual?: number
          estado?: Database['public']['Enums']['estado_lote']
          observaciones?: string | null
          registrado_por?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          producto_id?: string
          proveedor_id?: string | null
          numero_lote?: string
          numero_factura?: string | null
          fecha_entrada?: string
          fecha_caducidad?: string | null
          costo_unitario?: number | null
          cantidad_inicial?: number
          cantidad_actual?: number
          estado?: Database['public']['Enums']['estado_lote']
          observaciones?: string | null
          registrado_por?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'lotes_producto_id_fkey'
            columns: ['producto_id']
            isOneToOne: false
            referencedRelation: 'productos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'lotes_proveedor_id_fkey'
            columns: ['proveedor_id']
            isOneToOne: false
            referencedRelation: 'proveedores'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'lotes_registrado_por_fkey'
            columns: ['registrado_por']
            isOneToOne: false
            referencedRelation: 'usuarios'
            referencedColumns: ['id']
          },
        ]
      }
      stock_ubicacion: {
        Row: {
          id: string
          producto_id: string
          ubicacion_id: string
          cantidad_actual: number
          ultima_actualizacion: string
        }
        Insert: {
          id?: string
          producto_id: string
          ubicacion_id: string
          cantidad_actual?: number
          ultima_actualizacion?: string
        }
        Update: {
          id?: string
          producto_id?: string
          ubicacion_id?: string
          cantidad_actual?: number
          ultima_actualizacion?: string
        }
        Relationships: [
          {
            foreignKeyName: 'stock_ubicacion_producto_id_fkey'
            columns: ['producto_id']
            isOneToOne: false
            referencedRelation: 'productos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'stock_ubicacion_ubicacion_id_fkey'
            columns: ['ubicacion_id']
            isOneToOne: false
            referencedRelation: 'ubicaciones'
            referencedColumns: ['id']
          },
        ]
      }
      movimientos: {
        Row: {
          id: string
          tipo: Database['public']['Enums']['tipo_movimiento']
          producto_id: string
          lote_id: string | null
          ubicacion_origen_id: string | null
          ubicacion_destino_id: string | null
          cantidad: number
          costo_snapshot: number | null
          numero_factura: string | null
          proveedor_id: string | null
          comentario: string | null
          usuario_id: string
          movimiento_padre_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          tipo: Database['public']['Enums']['tipo_movimiento']
          producto_id: string
          lote_id?: string | null
          ubicacion_origen_id?: string | null
          ubicacion_destino_id?: string | null
          cantidad: number
          costo_snapshot?: number | null
          numero_factura?: string | null
          proveedor_id?: string | null
          comentario?: string | null
          usuario_id: string
          movimiento_padre_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          tipo?: Database['public']['Enums']['tipo_movimiento']
          producto_id?: string
          lote_id?: string | null
          ubicacion_origen_id?: string | null
          ubicacion_destino_id?: string | null
          cantidad?: number
          costo_snapshot?: number | null
          numero_factura?: string | null
          proveedor_id?: string | null
          comentario?: string | null
          usuario_id?: string
          movimiento_padre_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'movimientos_producto_id_fkey'
            columns: ['producto_id']
            isOneToOne: false
            referencedRelation: 'productos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'movimientos_lote_id_fkey'
            columns: ['lote_id']
            isOneToOne: false
            referencedRelation: 'lotes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'movimientos_ubicacion_origen_id_fkey'
            columns: ['ubicacion_origen_id']
            isOneToOne: false
            referencedRelation: 'ubicaciones'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'movimientos_ubicacion_destino_id_fkey'
            columns: ['ubicacion_destino_id']
            isOneToOne: false
            referencedRelation: 'ubicaciones'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'movimientos_proveedor_id_fkey'
            columns: ['proveedor_id']
            isOneToOne: false
            referencedRelation: 'proveedores'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'movimientos_usuario_id_fkey'
            columns: ['usuario_id']
            isOneToOne: false
            referencedRelation: 'usuarios'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'movimientos_movimiento_padre_id_fkey'
            columns: ['movimiento_padre_id']
            isOneToOne: false
            referencedRelation: 'movimientos'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      v_alertas_caducidad: {
        Row: {
          id: string | null
          producto: string | null
          codigo_barras: string | null
          numero_lote: string | null
          numero_factura: string | null
          fecha_caducidad: string | null
          dias_restantes: number | null
          costo_unitario: number | null
          estado: Database['public']['Enums']['estado_lote'] | null
          proveedor: string | null
        }
        Relationships: []
      }
      v_analisis_reposicion: {
        Row: {
          producto_id: string | null
          concepto: string | null
          codigo_barras: string | null
          ubicacion: string | null
          codigo_ubicacion: string | null
          cantidad_actual: number | null
          stock_minimo: number | null
          punto_reorden: number | null
          // Nombre y literales confirmados contra la vista real desplegada
          // en Supabase (corrección recibida el 17/06/2026). El tipo se deja
          // como unión abierta porque solo se confirmaron estos dos valores
          // de alerta — si la vista también emite un tercer estado para
          // stock saludable, hay que añadirlo aquí en cuanto se confirme.
          estado_logistico:
            | 'REQUERIR COMPRA (PUNTO REORDEN)'
            | 'ROTURA DE STOCK / CRÍTICO'
            | string
            | null
          ultima_actualizacion: string | null
        }
        Relationships: []
      }
      v_valorizacion_inventario: {
        Row: {
          area: string | null
          codigo_barras: string | null
          concepto: string | null
          categoria: string | null
          cantidad_actual: number | null
          precio_unitario: number | null
          valor_total: number | null
          estado: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      fn_obtener_rol_actual: {
        Args: Record<PropertyKey, never>
        Returns: Database['public']['Enums']['rol_usuario']
      }
      fn_registrar_traspaso: {
        Args: {
          p_producto_id: string
          p_ubicacion_origen_id: string
          p_ubicacion_destino_id: string
          p_cantidad: number
          p_usuario_id: string
          p_lote_id?: string | null
        }
        Returns: Json
      }
    }
    Enums: {
      tipo_movimiento:
        | 'ENTRADA_PROVEEDOR'
        | 'TRASPASO_SALIDA'
        | 'TRASPASO_ENTRADA'
        | 'CONSUMO'
        | 'MERMA_CADUCIDAD'
        | 'AJUSTE_POSITIVO'
        | 'AJUSTE_NEGATIVO'
        | 'DEVOLUCION_PROVEEDOR'
      estado_lote: 'ACTIVO' | 'AGOTADO' | 'VENCIDO' | 'CUARENTENA'
      rol_usuario: 'ADMINISTRADOR' | 'PERSONAL_CLINICA'
      grupo_financiero_categoria: 'MATERIAL_DENTAL' | 'MATERIAL_LIMPIEZA'
      unidad_medida:
        | 'PIEZA'
        | 'CAJA'
        | 'FRASCO'
        | 'AMPOLLETA'
        | 'SOBRE'
        | 'ROLLO'
        | 'KIT'
        | 'LITRO'
        | 'GRAMO'
        | 'MILILITRO'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

/* ------------------------------------------------------------------
 * Helpers de conveniencia (no autogenerados por el CLI, pero es la
 * convención recomendada por Supabase para evitar escribir
 * Database['public']['Tables']['x']['Row'] en cada archivo de la
 * capa src/api/). Se mantienen aquí porque viven junto a Database.
 * ------------------------------------------------------------------ */

type PublicSchema = Database['public']

export type Tables<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Row']

export type TablesInsert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Insert']

export type TablesUpdate<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Update']

export type Views<T extends keyof PublicSchema['Views']> =
  PublicSchema['Views'][T]['Row']

export type Enums<T extends keyof PublicSchema['Enums']> =
  PublicSchema['Enums'][T]

/* Alias de dominio usados frecuentemente en src/api/ */
export type Producto = Tables<'productos'>
export type Usuario = Tables<'usuarios'>
export type Lote = Tables<'lotes'>
export type Movimiento = Tables<'movimientos'>
export type StockUbicacion = Tables<'stock_ubicacion'>
export type Categoria = Tables<'categorias'>
export type Proveedor = Tables<'proveedores'>
export type Ubicacion = Tables<'ubicaciones'>
export type RolUsuario = Enums<'rol_usuario'>
export type TipoMovimiento = Enums<'tipo_movimiento'>