export type Category = string
export type Client = "chrome" | "chatgpt" | "cursor" | "windsurf" | "terminal" | "api"

export interface Memory {
  id: string
  memory: string
  metadata: Record<string, unknown> | null
  client: Client
  categories: Category[]
  created_at: number
  app_name: string
  state: "active" | "paused" | "archived" | "deleted"
}