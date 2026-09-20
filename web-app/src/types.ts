export interface Printer {
  id: string;
  serial: string;
  model: string;
  ip_address: string;
  is_online: boolean;
  last_seen_at?: string | null;
  current_task?: string;
  print_progress?: number;
  remaining_time_min?: number;
  current_layer?: number;
  total_layers?: number;
  nozzle_temp?: number;
  nozzle_target_temp?: number;
  bed_temp?: number;
  bed_target_temp?: number;
  gcode_state?: string;
  active_slot_index?: number;
}

export interface Spool {
  id: string;
  nfc_uid: string;
  brand: string;
  material: string;
  color_name: string;
  color_hex: string;
  current_weight: number;
  initial_weight?: number;
  spool_tare_weight?: number;
  price_paid?: number;
  nfc_written_at?: string | null;
}

export interface CatalogItem {
  id: string;
  name: string;
  material: string;
  weight_g: number;
  print_hours: number;
  accessories_cost: number;
  production_cost: number;
  sale_price: number;
  created_at: string;
}

export interface PrintLog {
  id: string;
  subtask_name: string;
  filament_used_g?: number;
  print_duration_minutes: number;
  slot_index: number;
  completed_at: string;
  status: string;
  needs_weighing?: boolean;
  spool_id?: string;
  spool?: Spool;
}
