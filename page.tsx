"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Camera, Upload, Scan, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

declare var jsQR: any

export default function QRReader() {
  const [qrData, setQrData] = useState<string | null>(null)
  const [parsedData, setParsedData] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState("archivo")
  const [isScanning, setIsScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const processImage = (imageElement: HTMLImageElement) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    canvas.width = imageElement.width
    canvas.height = imageElement.height
    ctx.drawImage(imageElement, 0, 0)

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

    try {
      const code = jsQR(imageData.data, canvas.width, canvas.height)

      if (code) {
        setQrData(code.data)
        parseQRData(code.data)
        setError(null)
      } else {
        setQrData(null)
        setParsedData({})
        setError("No se detectó ningún código QR en la imagen")
      }
    } catch (err) {
      setError("Error al procesar el código QR")
      console.error(err)
    }
  }

  const parseQRData = (data: string) => {
    const result: Record<string, string> = {}

    if (data.startsWith("http")) {
      result["URL"] = data
    } else if (data.startsWith("BEGIN:VCARD")) {
      const lines = data.split("\n")
      for (const line of lines) {
        if (line.startsWith("FN:")) result["Nombre"] = line.substring(3)
        if (line.startsWith("TEL:")) result["Teléfono"] = line.substring(4)
        if (line.startsWith("EMAIL:")) result["Email"] = line.substring(6)
        if (line.startsWith("ADR:")) result["Dirección"] = line.substring(4)
      }
    } else if (/^[0-9]{14}/.test(data)) {
      parseEMVQRCode(data, result)
    } else if (data.includes("5915")) {
      const nameMatch = data.match(/5915([A-Z ]+)/)
      if (nameMatch) {
        result["Nombre"] = nameMatch[1].trim()
      }

      const parts = data.split(/[;?&]/)
      for (const part of parts) {
        const keyValue = part.split("=")
        if (keyValue.length === 2) {
          result[keyValue[0]] = keyValue[1]
        }
      }
    } else {
      const delimiters = [";", ":", "=", "&", "|"]
      let foundStructure = false

      for (const delimiter of delimiters) {
        if (data.includes(delimiter)) {
          const parts = data.split(delimiter)
          if (parts.length > 1) {
            foundStructure = true
            for (let i = 0; i < parts.length; i += 2) {
              if (i + 1 < parts.length) {
                const key = parts[i].trim()
                const value = parts[i + 1].trim()
                if (key && value) {
                  result[`Campo ${i / 2 + 1}`] = `${key}: ${value}`
                }
              }
            }
            break
          }
        }
      }

      if (!foundStructure) {
        result["Texto completo"] = data
      }
    }

    setParsedData(result)
  }

  const parseEMVQRCode = (data: string, result: Record<string, string>) => {
    const emvTags: Record<string, string> = {
      "00": "Formato",
      "01": "Versión",
      "26": "Dirección",
      "52": "Categoría",
      "53": "Moneda",
      "58": "País",
      "59": "Nombre",
      "60": "Ciudad",
      "62": "Datos adicionales",
      "64": "Datos adicionales",
      "92": "Datos adicionales",
    }

    let position = 0

    while (position < data.length) {
      const tag = data.substring(position, position + 2)
      position += 2

      if (position >= data.length) break

      const lengthStr = data.substring(position, position + 2)
      const length = Number.parseInt(lengthStr, 10)
      position += 2

      if (position + length > data.length) break

      const value = data.substring(position, position + length)
      position += length

      const tagName = emvTags[tag] || `Tag ${tag}`

      if (tag === "59") {
        result["Nombre"] = value.trim()
      } else if (tag === "26") {
        result["Dirección"] = value.trim()
      } else if (tag === "60") {
        result["Ciudad"] = value.trim()
      } else if (tag === "62") {
        parseSubtags(value, result)
      } else {
        result[tagName] = value
      }
    }
  }

  const parseSubtags = (data: string, result: Record<string, string>) => {
    let position = 0

    while (position < data.length) {
      const tag = data.substring(position, position + 2)
      position += 2

      if (position >= data.length) break

      const lengthStr = data.substring(position, position + 2)
      const length = Number.parseInt(lengthStr, 10)
      position += 2

      if (position + length > data.length) break

      const value = data.substring(position, position + length)
      position += length

      if (tag === "01") {
        result["Referencia"] = value
      } else if (tag === "05") {
        result["Tipo de pago"] = value
      } else if (tag === "ES") {
        result["Destinatario"] = value
      } else {
        result[`Subtag ${tag}`] = value
      }
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const img = new Image()
    img.onload = () => processImage(img)
    img.src = URL.createObjectURL(file)
  }

  const startCamera = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        })

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          streamRef.current = stream
          setIsScanning(true)
          scanQRCode()
        }
      } else {
        setError("Tu navegador no soporta acceso a la cámara")
      }
    } catch (err) {
      setError("Error al acceder a la cámara")
      console.error(err)
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setIsScanning(false)
  }

  const scanQRCode = () => {
    if (!isScanning) return

    const video = videoRef.current
    const canvas = canvasRef.current

    if (!video || !canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

      try {
        const code = jsQR(imageData.data, canvas.width, canvas.height)

        if (code) {
          setQrData(code.data)
          parseQRData(code.data)
          stopCamera()
          setError(null)
          return
        }
      } catch (err) {
        console.error(err)
      }
    }

    requestAnimationFrame(scanQRCode)
  }

  useEffect(() => {
    setQrData(null)
    setParsedData({})
    setError(null)

    if (activeTab === "camara") {
      startCamera()
    } else {
      stopCamera()
    }

    return () => {
      stopCamera()
    }
  }, [activeTab])

  return (
    <div className="container max-w-md mx-auto p-4">
      <h1 className="text-2xl font-bold text-center mb-6">Lector QR Nêqu1</h1>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-2 mb-4">
          <TabsTrigger value="archivo">
            <Upload className="mr-2 h-4 w-4" />
            Archivo
          </TabsTrigger>
          <TabsTrigger value="camara">
            <Camera className="mr-2 h-4 w-4" />
            Cámara
          </TabsTrigger>
        </TabsList>

        <TabsContent value="archivo" className="mt-0">
          <Card className="p-4">
            <div className="flex flex-col items-center">
              <Button onClick={() => fileInputRef.current?.click()} className="w-full mb-4">
                <Upload className="mr-2 h-4 w-4" />
                Seleccionar imagen
              </Button>
              <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="camara" className="mt-0">
          <Card className="p-4">
            <div className="relative">
              <video ref={videoRef} autoPlay playsInline className="w-full rounded-md" />
              {isScanning && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="border-2 border-red-500 w-64 h-64 rounded-lg"></div>
                </div>
              )}
            </div>
            {!isScanning && (
              <Button onClick={startCamera} className="w-full mt-4">
                <Scan className="mr-2 h-4 w-4" />
                Iniciar escaneo
              </Button>
            )}
            {isScanning && (
              <Button onClick={stopCamera} variant="destructive" className="w-full mt-4">
                <X className="mr-2 h-4 w-4" />
                Detener escaneo
              </Button>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <canvas ref={canvasRef} className="hidden" />

      {error && <div className="mt-4 p-3 bg-red-100 text-red-800 rounded-md">{error}</div>}

      {qrData && (
        <Card className="mt-4 p-4">
          <h2 className="text-lg font-semibold mb-2">Datos detectados:</h2>

          {Object.keys(parsedData).length > 0 ? (
            <div className="space-y-2">
              {Object.entries(parsedData).map(([key, value]) => (
                <div key={key} className="border-b pb-2">
                  <span className="font-medium">{key}:</span> <span className="break-words">{value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="border-b pb-2">
              <span className="font-medium">Texto completo:</span> <span className="break-words">{qrData}</span>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
