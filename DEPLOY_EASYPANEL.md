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
GHL_PATIENT_DOCUMENT_FIELD_ID=lF4RWq25UPi4mdqnbrx9,ojop67QjbwNC7Kw1uyLu
GHL_PATIENT_DNI_FIELD_ID=lF4RWq25UPi4mdqnbrx9
GHL_PATIENT_NIF_FIELD_ID=ojop67QjbwNC7Kw1uyLu
GHL_PATIENT_BIRTH_DATE_FIELD_ID=
```

La fecha de cumpleaÃ±os/nacimiento llega desde el campo estÃ¡ndar de GHL
`dateOfBirth`, por eso `GHL_PATIENT_BIRTH_DATE_FIELD_ID` puede quedarse vacÃ­o
mientras no exista un custom field especÃ­fico de nacimiento.

El token privado debe tener permiso de lectura de contactos (`contacts.readonly`)
y permiso para enviar mensajes (`conversations/message.write`).
Si cambias variables en EasyPanel, reinicia o redepliega la app.

Los IDs de custom fields tambien pueden ir separados por coma si hay mas de un
campo posible, por ejemplo `GHL_PATIENT_DOCUMENT_FIELD_ID=id_dni,id_nif`.

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

La app no necesita una base de datos. Solo guarda un registro técnico mínimo en
`/app/.data` para que el QR pueda volver a abrir la receta/PDF después de
generarse. En EasyPanel crea un volumen persistente montado en:

```txt
/app/.data
```
