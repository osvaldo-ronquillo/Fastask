# FasTask Agent API

Puerta con llave para que un asistente (Muse u otro) lea y escriba tareas.
Empieza en **solo lectura** (`WRITE_ENABLED = "0"` en `wrangler.toml`).

## Despliegue (una vez)

1. **Cuenta de servicio.** Firebase Console > Configuracion del proyecto > Cuentas de servicio >
   "Generar nueva clave privada". Baja un JSON. No lo subas al repo.
   Si la consola ofrece un rol limitado, usa "Cloud Datastore User".
2. **Instalar y entrar:** `npm i -g wrangler` y `wrangler login`.
3. **Secretos** (desde esta carpeta; cada comando pide el valor):
   ```
   wrangler secret put AGENT_API_KEY          # inventa una larga: python -c "import secrets;print(secrets.token_urlsafe(32))"
   wrangler secret put FIREBASE_PROJECT_ID    # project_id del JSON
   wrangler secret put FIREBASE_CLIENT_EMAIL  # client_email del JSON
   wrangler secret put FIREBASE_PRIVATE_KEY   # private_key del JSON, completa, con los \n
   ```
4. `wrangler deploy`. Anota la URL `https://fastask-agent-api.<tu-subdominio>.workers.dev`.
5. Borra el JSON de la cuenta de servicio de tu equipo.

## Probar

```
curl -H "Authorization: Bearer TU_LLAVE" https://TU-WORKER.workers.dev/summary
```

## Conectar a Muse

Ajustes > Conectores > conector personalizado. URL base del Worker, autenticacion API key
(encabezado `Authorization: Bearer`). Si pide descripcion de la API, usa `openapi.yaml` de esta carpeta
(cambia el `servers.url`). Mete la llave solo en el flujo seguro de conexion, nunca en el chat.

## Pasar a lectura y escritura

Cambia `WRITE_ENABLED` a `"1"` en `wrangler.toml` y `wrangler deploy`. Muse pide tu aprobacion antes de escribir.

## Instruccion sugerida para Muse (tarea programada)

> Cada manana a las 8:00 llama a `getSummary` de FasTask. Avisame por WhatsApp de lo vencido, lo de hoy
> y lo que vence en 3 dias, con la categoria. Si hay algo estancado, preguntame que bloquea. No
> crees tareas sin mostrarmelas antes. Categoria: todo lo de Interia es `trabajo`.

## Seguridad

- La llave solo vive como secreto del Worker y en el conector. Si se filtra: `wrangler secret put AGENT_API_KEY` con una nueva.
- No existe ruta para borrar. El asistente solo puede crear, cambiar campos permitidos y completar.
- El Worker toca solo la coleccion `voztasks`.
- Aviso: lo que lea Muse pasa por servidores de Meta. Revisa la politica de Interia antes de conectar tareas de trabajo.
