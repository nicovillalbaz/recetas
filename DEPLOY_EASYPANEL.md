# Deploy en EasyPanel

## App

- Tipo: Dockerfile
- Puerto interno: `3000`
- Dominio/URL publica: usa la URL HTTPS donde EasyPanel publique la app.
- Montaje persistente obligatorio: `/app/.data`

## Variables

```env
NEXT_PUBLIC_APP_URL=https://tu-url-publica
GHL_PRIVATE_TOKEN=token_privado_de_highlevel
GHL_LOCATION_ID=oHE4xQTwNInUOTgcLcJJ
GHL_API_VERSION=2021-07-28

GHL_APP_SHARED_SECRET=shared_secret_de_marketplace_app
APP_SESSION_SECRET=secreto_largo_para_firmar_sesiones
APP_ENCRYPTION_KEY=clave_base64_de_32_bytes
APP_DATA_DIR=/app/.data

# Opcional si se usa exposeSessionDetails(APP_ID) fuera de custom pages.
NEXT_PUBLIC_GHL_APP_ID=id_de_la_marketplace_app

# Opcional si estos datos estan en campos personalizados de GHL
GHL_PATIENT_DOCUMENT_FIELD_ID=lF4RWq25UPi4mdqnbrx9,ojop67QjbwNC7Kw1uyLu
GHL_PATIENT_DNI_FIELD_ID=lF4RWq25UPi4mdqnbrx9
GHL_PATIENT_NIF_FIELD_ID=ojop67QjbwNC7Kw1uyLu
GHL_PATIENT_BIRTH_DATE_FIELD_ID=
```

La fecha de cumpleanos/nacimiento llega desde el campo estandar de GHL
`dateOfBirth`, por eso `GHL_PATIENT_BIRTH_DATE_FIELD_ID` puede quedarse vacio
mientras no exista un custom field especifico de nacimiento.

`GHL_APP_SHARED_SECRET` sale de la app de Marketplace en GHL. La app lo usa solo
en backend para descifrar el User Context/SSO del iframe. `APP_SESSION_SECRET`
firma sesiones cortas guardadas en `sessionStorage`. `APP_ENCRYPTION_KEY` debe
ser una clave de 32 bytes en base64, por ejemplo generada con:

```bash
openssl rand -base64 32
```

## Permisos GHL

El token privado debe tener como minimo:

- lectura de contactos;
- lectura de custom fields si se usan DNI/NIF personalizados;
- envio de mensajes/SMS;
- notas de contacto si quieres que la receta cree notas best-effort en GHL.

Si cambias variables en EasyPanel, reinicia o redepliega la app.

Los IDs de custom fields tambien pueden ir separados por coma si hay mas de un
campo posible, por ejemplo `GHL_PATIENT_DOCUMENT_FIELD_ID=id_dni,id_nif`.

## SSO dentro de GHL

La app intenta iniciar sesion automaticamente dentro del iframe usando User
Context de GHL:

1. El frontend pide el payload cifrado a GHL con `REQUEST_USER_DATA`.
2. El backend lo descifra con `GHL_APP_SHARED_SECRET`.
3. Solo acepta sesiones donde `activeLocation` coincide con `GHL_LOCATION_ID`.
4. Devuelve una sesion corta firmada que queda en `sessionStorage`.

Fuera de GHL solo funciona la ventana externa temporal de AutoFirma, abierta con
un token de firma de pocos minutos.

## Boton flotante en GHL

Para tener un boton `Hacer receta` dentro de la ficha/contacto de GHL solo en la
subcuenta de Duran, instala el userscript `ghl-duran-recetas.user.js` en el
navegador de la doctora con Tampermonkey.

El script solo se ejecuta en:

```txt
https://crm.viraltia.com/v2/location/oHE4xQTwNInUOTgcLcJJ/*
```

Funcionamiento:

- detecta el `contactId` desde `/contacts/detail/{contactId}` o enlaces de la
  vista de contacto;
- muestra el boton flotante `Hacer receta`;
- abre el custom menu link existente:
  `https://crm.viraltia.com/v2/location/oHE4xQTwNInUOTgcLcJJ/custom-menu-link/eb28c946-6b6b-46db-982c-51a50d3f399e`;
- actualiza el iframe para anadir `locationId` y `contactId`, de modo que la app
  cargue el paciente automaticamente.

## Persistencia

La app usa almacenamiento propio minimo para que el QR, historial y PDFs firmados
sigan disponibles despues de reinicios. En EasyPanel crea un volumen persistente
montado en:

```txt
/app/.data
```

Dentro se guardan:

- `/app/.data/recetas.db`: SQLite con recetas, usuarios GHL, eventos de auditoria
  y metadatos.
- `/app/.data/files/signed-pdfs`: PDFs firmados.
- rubricas visuales PNG/JPG convertidas a JPEG y cifradas por usuario GHL.

No se guardan certificados `.p12/.pfx`, claves privadas ni contrasenas. AutoFirma
usa el certificado local del equipo; la alternativa `.p12/.pfx` solo procesa el
archivo temporalmente en el navegador.
