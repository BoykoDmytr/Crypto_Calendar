import { supabase } from './supabase';

export async function fetchEventTypes() {
  const { data, error } = await supabase
    .from('event_types')
    .select('*')
    .eq('active', true)
    .order('order_index', { ascending: true });
  if (error) throw error;
  return data || [];
}
