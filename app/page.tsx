'use client'

import { useSearchParams } from 'next/navigation'
import { useState } from 'react'

export default function Home() {
  const params = useSearchParams()
  const locationId = params.get('locationId')

  const [busqueda, setBusqueda] = useState('')
  const [medicamento, setMedicamento] = useState('')

  const guardarReceta = async () => {
    alert(`Receta guardada (demo)
Location: ${locationId}
Paciente: ${busqueda}
Medicamento: ${medicamento}`)
  }

  return (
    <div style={{
      maxWidth: 600,
      margin: '40px auto',
      fontFamily: 'system-ui'
    }}>
      <h1>Recetas REMPe</h1>

      <p><strong>Location ID:</strong> {locationId}</p>

      <hr />

      <h3>Buscar paciente</h3>
      <input
        placeholder="Teléfono, email o DNI"
        value={busqueda}
        onChange={e => setBusqueda(e.target.value)}
        style={{ width: '100%', padding: 8 }}
      />

      <h3 style={{ marginTop: 20 }}>Nueva receta</h3>
      <input
        placeholder="Medicamento"
        value={medicamento}
        onChange={e => setMedicamento(e.target.value)}
        style={{ width: '100%', padding: 8 }}
      />

      <button
        onClick={guardarReceta}
        style={{
          marginTop: 20,
          padding: 10,
          width: '100%',
          background: '#2563eb',
          color: 'white',
          border: 'none',
          borderRadius: 6
        }}
      >
        Guardar receta (demo)
      </button>
    </div>
  )
}
