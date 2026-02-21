"use client"

import { Download, Upload } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Label } from "./ui/label"
import { Button } from "./ui/button"
import { Textarea } from "./ui/textarea"
import { useRef, useState as useReactState } from "react"
import { useSelector } from "react-redux"
import { RootState } from "@/store/store"

interface FormViewProps {
  settings: any
  onChange: (settings: any) => void
}

export function FormView({ settings, onChange }: FormViewProps) {
  const [isUploading, setIsUploading] = useReactState(false)
  const [selectedImportFileName, setSelectedImportFileName] = useReactState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const userId = useSelector((state: RootState) => state.profile.userId)

  const handleOpenMemoryChange = (key: string, value: any) => {
    onChange({
      ...settings,
      openmemory: {
        ...settings.openmemory,
        [key]: value,
      },
    })
  }

  return (
    <div className="space-y-8">
      {/* OpenMemory Settings */}
      <Card>
        <CardHeader>
          <CardTitle>OpenMemory Settings</CardTitle>
          <CardDescription>Configure your OpenMemory instance settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="custom-instructions">Custom Instructions</Label>
            <Textarea
              id="custom-instructions"
              placeholder="Enter custom instructions for memory management..."
              value={settings.openmemory?.custom_instructions || ""}
              onChange={(e) => handleOpenMemoryChange("custom_instructions", e.target.value)}
              className="min-h-[100px]"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Custom instructions that will be used to guide memory processing and fact extraction.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Backup (Export / Import) */}
      <Card>
        <CardHeader>
          <CardTitle>Backup</CardTitle>
          <CardDescription>Export or import your memories</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Export Section */}
          <div className="p-4 border border-zinc-800 rounded-lg space-y-2">
            <div className="text-sm font-medium">Export</div>
            <p className="text-xs text-muted-foreground">Download a ZIP containing your memories.</p>
            <div>
              <Button
                type="button"
                className="bg-zinc-800 hover:bg-zinc-700"
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/v1/backup/export`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json", Accept: "application/zip" },
                      body: JSON.stringify({ user_id: userId }),
                    })
                    if (!res.ok) throw new Error(`Export failed with status ${res.status}`)
                    const blob = await res.blob()
                    const url = window.URL.createObjectURL(blob)
                    const a = document.createElement("a")
                    a.href = url
                    a.download = `memories_export.zip`
                    document.body.appendChild(a)
                    a.click()
                    a.remove()
                    window.URL.revokeObjectURL(url)
                  } catch (e) {
                    console.error(e)
                    alert("Export failed. Check console for details.")
                  }
                }}
              >
                <Download className="h-4 w-4 mr-2" /> Export Memories
              </Button>
            </div>
          </div>

          {/* Import Section */}
          <div className="p-4 border border-zinc-800 rounded-lg space-y-2">
            <div className="text-sm font-medium">Import</div>
            <p className="text-xs text-muted-foreground">Upload a ZIP exported by OpenMemory. Default settings will be used.</p>
            <div className="flex items-center gap-3 flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(evt) => {
                  const f = evt.target.files?.[0]
                  if (!f) return
                  setSelectedImportFileName(f.name)
                }}
              />
              <Button
                type="button"
                className="bg-zinc-800 hover:bg-zinc-700"
                onClick={() => {
                  if (fileInputRef.current) fileInputRef.current.click()
                }}
              >
                <Upload className="h-4 w-4 mr-2" /> Choose ZIP
              </Button>
              <span className="text-xs text-muted-foreground truncate max-w-[220px]">
                {selectedImportFileName || "No file selected"}
              </span>
              <div className="ml-auto">
                <Button
                  type="button"
                  disabled={isUploading || !fileInputRef.current}
                  className="bg-primary hover:bg-primary/80 disabled:opacity-50"
                  onClick={async () => {
                    const file = fileInputRef.current?.files?.[0]
                    if (!file) return
                    try {
                      setIsUploading(true)
                      const form = new FormData()
                      form.append("file", file)
                      form.append("user_id", String(userId))
                      const res = await fetch(`/api/v1/backup/import`, { method: "POST", body: form })
                      if (!res.ok) throw new Error(`Import failed with status ${res.status}`)
                      await res.json()
                      if (fileInputRef.current) fileInputRef.current.value = ""
                      setSelectedImportFileName("")
                    } catch (e) {
                      console.error(e)
                      alert("Import failed. Check console for details.")
                    } finally {
                      setIsUploading(false)
                    }
                  }}
                >
                  {isUploading ? "Uploading..." : "Import"}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
} 