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
```

## Persistencia

La app actual guarda recetas en `/app/.data`. En EasyPanel crea un volumen
persistente montado en:

```txt
/app/.data
```

Para producción final, lo ideal es migrar ese almacenamiento a Postgres.
