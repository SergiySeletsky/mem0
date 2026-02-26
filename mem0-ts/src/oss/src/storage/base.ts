export interface HistoryRecord {
  id: string;
  memory_id: string;
  previous_value: string | null;
  new_value: string | null;
  action: string;
  created_at: string;
  updated_at: string | null;
  is_deleted: number;
}

export interface HistoryManager {
  addHistory(
    memoryId: string,
    previousValue: string | null,
    newValue: string | null,
    action: string,
    createdAt?: string,
    updatedAt?: string,
    isDeleted?: number,
  ): Promise<void>;
  getHistory(memoryId: string): Promise<HistoryRecord[]>;
  reset(): Promise<void>;
  close(): void;
}
