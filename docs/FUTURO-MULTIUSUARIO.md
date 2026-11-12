# Si FasTask se abre al publico

Hoy FasTask es personal: una sola coleccion `voztasks`, sin separar por usuario, y el Worker de agentes
usa una cuenta de servicio compartida. Eso NO sirve tal cual para un producto abierto. Pendiente en ese caso:

1. **Datos por usuario.** Guardar tareas en `users/{uid}/tasks` y reglas de Firestore que solo dejen leer/escribir al dueno.
2. **Llaves por usuario.** Cada quien genera y revoca su llave en Ajustes. Guardar solo el hash. El Worker busca
   la llave, obtiene el uid y limita todo a ese usuario. Se elimina la cuenta de servicio con acceso global.
3. **Alta con Google** (ya existe) y un onboarding corto: copiar llave, pegarla en el asistente.
4. **Servidor MCP** sobre la misma API, para asistentes que lo soporten, y guia para conectarlos.
5. **Limites:** tope de peticiones por llave y de tamano, para que nadie gaste recursos.
6. **Privacidad:** aviso claro de que un asistente conectado lee las tareas del usuario.
7. **Migracion** de los datos actuales a la estructura por usuario.

Principio: el producto (tablero, etiquetas, prioridades, diseno) funciona solo. Los asistentes son un cliente opcional.
