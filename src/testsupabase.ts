import { supabase } from './lib/supabase'

export async function testSupabase() {
  const { data, error } = await supabase
    .from('categorias')
    .select('*')

  if (error) {
    console.error('❌ Error conectando con Supabase:', error)
    return
  }

  console.log('✅ Supabase conectado correctamente')
  console.log('Categorías:', data)
}