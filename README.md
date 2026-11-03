# TRAYECTO Quiz × UDAT Formación

Juego de capacitación de semirremolques **tipo Kahoot**: el instructor proyecta preguntas, comparte un código de sala y los participantes responden desde sus celulares. Incluye temporizador, cuatro respuestas (▲ ◆ ● ■), ranking, banco de preguntas y exportación CSV.

**Arquitectura:** interfaz estática de Vercel + función `api/game.js` + Google Apps Script + tres pestañas de Google Sheets. **No utiliza Supabase.**

## Preparar Google Sheets

1. Abre [Google Sheets](https://sheets.google.com) y crea una hoja nueva **privada**.
2. Ve a **Extensiones → Apps Script**, borra el ejemplo y pega todo `apps-script/Code.gs`.
3. Guarda, selecciona la función **`configurar`** y pulsa **Ejecutar**. Autoriza los permisos solicitados.
4. Se crearán **Salas**, **Participantes** y **Respuestas**. Abre el **Registro de ejecución** y copia el valor `GOOGLE_SCRIPT_SECRET` a un lugar seguro. **No publiques ni compartas este secreto.**
5. Ve a **Implementar → Nueva implementación → Aplicación web**. Selecciona **Ejecutar como: Yo** y **Quién tiene acceso: Cualquier persona**. Copia la URL que termina en `/exec`.
6. Si posteriormente modificas Apps Script, publica una **nueva versión** de la implementación web.

## Publicar en Vercel

1. Abre [Vercel New Project](https://vercel.com/new) e importa el repositorio `jorgealbertocervantes04-sys/trayecto-quiz-udat`.
2. Elige **Framework Preset: Other**, Node.js **20+**, **Build Command:** `npm run build` y **Output Directory:** `dist`. El archivo `vercel.json` ya incluye la configuración.
3. En **Environment Variables** añade estas dos variables, usando los valores de tu propia hoja:
   
   - `GOOGLE_SCRIPT_URL`: URL completa de Apps Script que termina en `/exec`.
   - `GOOGLE_SCRIPT_SECRET`: secreto mostrado por la función `configurar`.
4. Publica con **Deploy** y abre `https://TU-PROYECTO.vercel.app/api/game?op=health`. Debe indicar `"ok":true` y `"configured":true`.
5. Si configuraste las variables después del primer despliegue, usa **Redeploy**.

## Durante el curso

El instructor elige preguntas y segundos, pulsa **Crear sala en vivo**, comparte el enlace o código y espera a los participantes. Cuando estén conectados inicia la ronda. Los alumnos ven cuatro opciones de colores desde sus móviles. El instructor revela la respuesta, avanza y finalmente descarga el ranking en CSV.

La portada también permite **Probar en este equipo** sin conectar la hoja, pero para una sala con distintos dispositivos debes completar el despliegue en Vercel y Apps Script.

## Concurrencia y seguridad

- Capacidad configurada: **hasta 150 inscripciones por sala**. El objetivo es un mínimo de 30 participantes, pero **no hay garantía de rendimiento** hasta realizar una prueba con los 30 dispositivos reales en tu Vercel y Google Apps Script.
- Apps Script utiliza `LockService` para las escrituras y `CacheService` para reducir lecturas; el navegador consulta cada ~4,5 segundos. La actualización no es instantánea.
- El secreto se envía únicamente desde el backend de Vercel a Apps Script. **Nunca** debe añadirse a `public/index.html` ni al repositorio.
- Los nombres de participantes quedan almacenados en la hoja privada. Usa alias si necesitas minimizar datos personales.
- **El repositorio actual está público.** Si los logos y materiales son internos, cambia la visibilidad a **Private** en GitHub → Settings → General → Danger Zone. Vercel puede conectarse a repositorios privados autorizados.

## Estructura

| Ruta | Función |
|---|---|
| `public/index.html` | Interfaz completa responsive con logos y camiones integrados, dinámica y modo práctica |
| `api/game.js` | API de Vercel; genera tokens seguros, valida preguntas, envía operaciones y exporta CSV |
| `apps-script/Code.gs` | Google Sheets; salas, participantes, respuestas y sincronización |
| `scripts/build.mjs` | Copia `public/` a `dist/` durante el build |
| `tests/api.test.js` | Pruebas básicas de API y seguridad |
| `vercel.json` | Configuración del despliegue |
| `.env.example` | Plantilla de variables sin credenciales reales |

## Verificación y límites

```bash
npm test
npm run build
```

Estas pruebas validan casos básicos del backend y la compilación. **No sustituyen una prueba multijugador real con Google Sheets.** Antes de una capacitación con 30 asistentes, inicia una sala de prueba con todos conectados y una pregunta temporizada. Apps Script y Vercel tienen cuotas de ejecución y límites de tiempo.

Documentación: [Google Apps Script Web Apps](https://developers.google.com/apps-script/guides/web) · [Cuotas de Apps Script](https://developers.google.com/apps-script/guides/services/quotas) · [Variables de Vercel](https://vercel.com/docs/environment-variables).
