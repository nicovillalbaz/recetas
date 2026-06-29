# Deploy en EasyPanel

## App

- Tipo: Dockerfile
- Puerto interno: `3000`
- Dominio sugerido: `recetas.duranginecologia.com`

## Variables

```env
NEXT_PUBLIC_APP_URL=https://recetas.duranginecologia.com
GHL_PRIVATE_TOKEN=token_privado_de_highlevel
GHL_LOCATION_ID=id_de_la_subcuenta
GHL_API_VERSION=2021-07-28

# Opcional si estos datos estan en campos personalizados de GHL
GHL_PATIENT_DOCUMENT_FIELD_ID=id_del_campo_dni
GHL_PATIENT_BIRTH_DATE_FIELD_ID=id_del_campo_fecha_nacimiento
GHL_PATIENT_INSURANCE_FIELD_ID=id_del_campo_mutua
```

El token privado debe tener permiso de lectura de contactos (`contacts.readonly`).
Si cambias variables en EasyPanel, reinicia o redepliega la app.

## Persistencia

La app no necesita una base de datos. Solo guarda un registro técnico mínimo en
`/app/.data` para que el QR pueda volver a abrir la receta/PDF después de
generarse. En EasyPanel crea un volumen persistente montado en:

```txt
/app/.data
```
