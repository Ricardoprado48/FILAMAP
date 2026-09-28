export interface Printer {
  id: string;
  serial: string;
  model: string;
  ip_address: string;
  is_online: boolean;
  last_seen_at?: string | null;
  last_online?: string | null;
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
  // Somente leitura na Web -- preenchidos exclusivamente pelo Cloud Spool
  // Sync (desktop-agent/bambuCloudSpoolSync.ts). Nunca escrever nestes
  // campos a partir da Web.
  bambu_spool_id?: string | null;
  bambu_in_printer?: boolean | null;
  bambu_dev_id?: string | null;
  bambu_device_name?: string | null;
  bambu_ams_sn?: string | null;
  bambu_ams_id?: string | null;
  bambu_slot_id?: string | null;
  bambu_synced_at?: string | null;
  filament_profile_id?: string | null;
  // Localização física de armazenamento do carretel fora da impressora
  // (ex.: Prateleira A1, Gaveta 2, Caixa Seca 01, Rack B).
  location?: string | null;
  // Controlado pela Web: quando o usuário confirmou o peso real deste
  // carretel pela última vez (pesagem ou edição manual). NULL = ainda no
  // valor padrão/placeholder, nunca conferido.
  weight_confirmed_at?: string | null;
  // Identidade do carretel (F1): o produto de filamento. brand/material/cor
  // acima ficam como cópia legada, preenchida a partir do produto.
  filament_product_id?: string | null;
  // Arquivado (D4): some das listas, mas o histórico continua ligado a ele.
  archived_at?: string | null;
}

// Produto de filamento (marca + material + cor), com ID próprio e estável.
// Nasce de um perfil do Bambu Studio, de um preset oficial Bambu ou manual.
export interface FilamentProduct {
  id: string;
  user_id?: string;
  name: string;
  brand?: string | null;
  material?: string | null;
  color_name?: string | null;
  color_hex?: string | null;
  density?: number | null;
  origin: "bambu_studio" | "bambu_official" | "manual";
  archived_at?: string | null;
}

// Evidência externa aguardando decisão humana (nuvem Bambu, RFID, tag NFC
// desconhecida, preset renomeado). Nunca vira carretel sozinha.
export interface SpoolInboxItem {
  id: string;
  source: "bambu_cloud" | "rfid" | "nfc" | "preset_renamed";
  external_id: string;
  payload: Record<string, any>;
  suggested_spool_id?: string | null;
  suggested_product_id?: string | null;
  status: "pending" | "linked" | "created" | "ignored";
  resolved_spool_id?: string | null;
  created_at?: string;
}

export interface UserFilamentProfile {
  id: string;
  user_id: string;
  source: string;
  source_key: string;
  source_profile_name: string;
  display_name: string;
  material: string;
  color_name?: string | null;
  model_name?: string | null;
  brand?: string | null;
  source_metadata?: Record<string, unknown> | null;
  // false = perfil de pasta antiga do fatiador (guardado, fora da lista do
  // "Novo Carretel"). Ausente em banco sem a migration 20260928110000.
  is_listed?: boolean;
  filament_product_id?: string | null;
  last_seen_at?: string | null;
  created_at?: string;
  updated_at?: string;
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
  job_id?: string | null;
  orphan_slot?: boolean;
  consumption_quality?: string;
  // "Foto" do produto no momento da impressão (F1/F6): o histórico não muda
  // se o carretel ou o produto forem editados depois.
  filament_product_id?: string | null;
  product_name_snapshot?: string | null;
  brand_snapshot?: string | null;
  material_snapshot?: string | null;
  color_snapshot?: string | null;
}
