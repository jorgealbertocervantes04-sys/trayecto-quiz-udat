# TRAYECTO Quiz × UDAT Formación — Vercel + Google Sheets

**Aplicación web para cursos presenciales o virtuales**, con preguntas tipo Kahoot, camiones naranja TRAYECTO, respuestas por color y figura desde teléfonos, cuenta regresiva, puntajes y CSV. **Esta edición usa Google Sheets como única base de datos persistente: no requiere Supabase, Postgres ni claves de Google Cloud.**

**Estado:** proyecto de código preparado y probado con un simulador local de Apps Script y 30 jugadores. No se ha publicado en tus cuentas de Google/Vercel ni se ha hecho una prueba de carga real. El código admite 150 inscripciones por sala, pero **30 participantes reales no están garantizados** sin una prueba en el entorno de producción: Google Apps Script tiene límites de concurrencia y Google Sheets no está diseñado para actividad de baja latencia a gran escala.

## 1. Crear la base de datos Google Sheets

1. En [sheets.google.com](https://sheets.google.com), crea una hoja vacía, por ejemplo **TRAYECTO Quiz — Base de datos**. **No la hagas pública.**
2. Abre **Extensiones → Apps Script**. En el archivo `Code.gs` borra el contenido predeterminado y pega **todo** el código de `apps-script/Code.gs` de este ZIP.
3. Guarda el proyecto. En la barra superior elige la función **`configurar`** y pulsa **Ejecutar**. Autoriza el acceso a la hoja con la cuenta propietaria.
4. Abre **Registro de ejecución / Execution log**: verás `GOOGLE_SCRIPT_SECRET = ...`. **Copia el valor a un gestor seguro**; nunca lo incluyas en GitHub, en HTML ni en un mensaje público. Si cambias la propiedad `APP_SECRET` en Apps Script, también tendrás que actualizarla en Vercel.
5. La función `configurar` crea automáticamente tres pestañas:
   - **Salas:** código, fase, fecha límite y preguntas de la sesión.
   - **Participantes:** identificador, nombre y hash de sesión.
   - **Respuestas:** elección, momento, puntos y acierto por pregunta.

Los datos se conservan en la hoja aunque Vercel reinicie sus funciones. Puedes consultar la participación directamente en Google Sheets. **No edites ni reordenes columnas mientras haya una sala activa.**

## 2. Publicar Apps Script como servicio web

1. En Apps Script, pulsa **Implementar → Nueva implementación**.
2. Selecciona **Aplicación web / Web app**.
3. En **Ejecutar como**, elige **Yo** (la cuenta dueña de la hoja).
4. En **Quién tiene acceso**, selecciona **Cualquier persona** para que Vercel pueda consultar el servicio sin pedir inicio de sesión Google a tus asistentes. Si tu organización bloquea ese ajuste, tendrás que solicitar autorización al administrador.
5. Pulsa **Implementar** y copia la **URL de la aplicación web**, que acaba en `/exec`.
6. Cuando actualices `Code.gs` más adelante, ve a **Implementar → Administrar implementaciones → Editar → Nueva versión** para publicar los cambios. Editar el código sin actualizar la implementación puede dejar activa una versión anterior.

Aunque la app web sea accesible públicamente, el servidor de Apps Script **rechaza todas las operaciones que no lleven el secreto de la instalación**. Ese secreto lo envía únicamente la función privada de Vercel; los participantes jamás lo reciben. No compartas la URL `/exec` ni el secreto con los alumnos.

## 3. Publicar el frontend y API en Vercel

1. Sube **todo el contenido de esta carpeta** a un repositorio de GitHub. Verifica que no hayas incluido secretos reales ni archivos `.env` con credenciales.
2. Ve a [vercel.com/new](https://vercel.com/new), importa el repositorio y selecciona **Framework Preset: Other**.
3. Configuración recomendada: Build Command `npm run build`, Output Directory `dist`, Node.js 20 o superior. `vercel.json` ya establece los valores básicos.
4. En **Settings → Environment Variables** añade **dos variables privadas** (Production y, si quieres, Preview):

   | Nombre | Valor |
   |---|---|
   | `GOOGLE_SCRIPT_URL` | URL HTTPS `/exec` de la implementación de Apps Script |
   | `GOOGLE_SCRIPT_SECRET` | Valor generado por `configurar` (Execution log) |

5. Despliega con **Deploy**. Si agregaste variables después, haz **Redeploy**. Vercel usa estas variables solo dentro de la función `api/game.js`.
6. Comprueba la salud del backend: visita `https://TU-APP.vercel.app/api/game?op=health`. Debe devolver `"ok":true` y `"configured":true`. Si dice false, revisa los pasos 1 y 2.
7. En la URL pública de Vercel, abre **Soy instructor → Crear sala**. Envía el enlace que aparece en la sala, o comparte el código de 6 caracteres. Los participantes entran desde su celular en **Soy participante**.

**No uses el archivo HTML local con doble clic para el modo multijugador.** Esta edición requiere que la página esté alojada en Vercel y que Apps Script esté publicado.

## 4. Funcionamiento del curso

- El instructor edita sus preguntas (banco guardado en el navegador de ese instructor), elige duración y cantidad y crea sala.
- Los jugadores ingresan un nombre y código. La sala admite hasta **150 registros**, sujetos al rendimiento real de Google.
- Inicia el concurso; la pregunta aparece proyectada, y los celulares muestran cuatro botones rojo ▲, azul ◆, amarillo ● y verde ■.
- Cada respuesta entra a la pestaña **Respuestas** con bloqueo de escritura (`LockService`) para evitar que dos jugadores sobreescriban registros. Un jugador solo obtiene una respuesta puntuable por ronda.
- El reloj corre en el navegador pero el **límite efectivo** se comprueba en Apps Script: respuestas posteriores al vencimiento no cuentan. El instructor puede revelar antes del vencimiento.
- La puntuación se calcula en el servidor. El ranking y la respuesta correcta se muestran cuando la ronda se revela. Al terminar, el instructor exporta el archivo CSV.
- Si un usuario recarga su navegador, el mismo navegador puede recuperar su sesión desde `localStorage`, siempre que no se borren los datos locales. Los tokens se almacenan como hash SHA-256 en Sheets.

## 5. Rendimiento y capacidad real

Esta app usa **Google Sheets como registro persistente**, **Apps Script** como backend y una caché compartida de pocos segundos al consultar el estado desde Vercel. Cada celular consulta la sala aproximadamente cada **4–5 segundos**; el instructor, cada **3 segundos**. La respuesta se registra por POST en el momento en que el participante pulsa el botón.

Google Apps Script tiene, según su documentación, un límite de **30 ejecuciones simultáneas por usuario** y otras cuotas; el tiempo de ejecución, los permisos del dominio y la carga real pueden afectar la experiencia. La app tiene bloqueos y evita doble puntuación, pero **no garantiza el mismo tiempo de respuesta que Kahoot**. Para cursos de 30 personas, recomendamos realizar un simulacro de la pregunta 1 con todos los dispositivos antes del evento. Si necesitas respuesta inmediata con garantía de alta concurrencia, usa una base de datos transaccional y un servicio de comunicación en tiempo real.

La actualización puede demorarse varios segundos por el sondeo y la caché. No uses el juego para exámenes donde unos segundos de diferencia cambien sustancialmente una calificación. Para mantener baja la carga, evita abrir muchas salas a la vez y archiva las filas de cursos antiguos en otro archivo si la hoja crece mucho.

## 6. Seguridad y privacidad

- Mantén Google Sheets en modo **Privado**, compartido solamente con administradores autorizados.
- **Nunca** compartas el valor `GOOGLE_SCRIPT_SECRET` ni lo uses en JavaScript cliente. No incluyas un `service-account.json` en GitHub.
- El código de sala es un identificador de acceso; la lista de nombres y puntuaciones de ese curso es visible para quien conoce el código. Usa nombres de pila o alias si quieres minimizar información personal.
- La función Vercel valida las preguntas y genera tokens aleatorios; Apps Script mantiene la identidad del instructor y participantes y controla la puntuación.
- El almacenamiento es de larga duración por defecto. Para cumplir tu política de retención de datos, archiva o borra las filas de salas terminadas **cuando no se esté jugando** y consulta los requisitos de privacidad aplicables.

## 7. Pruebas y estructura

Requiere Node.js **20 o superior** para ejecutar las pruebas locales:

```bash
npm test
npm run build
```

`npm test` valida el código de Vercel contra un **simulador** de `SpreadsheetApp`, `LockService` y `CacheService` con 30 participantes. Esto verifica la lógica y los contratos; no representa una prueba de carga real, ni verifica que tu despliegue de Google o Vercel esté configurado.

| Archivo | Función |
|---|---|
| `apps-script/Code.gs` | Backend Google Sheets; crea pestañas y recibe operaciones |
| `api/game.js` | Función Vercel; autenticación, validación, proxy y CSV |
| `public/app.js` | Interfaz instructor/participantes; preguntas, ranking |
| `public/assets/` | Logos y semirremolques con cabina naranja |
| `tests/game.test.js` | Simulación del flujo de 30 jugadores |
| `.env.example` | Nombres de las dos variables que se configuran en Vercel |
| `vercel.json` | Construcción y función de servidor |

## 8. Solución de problemas

- **Falta configuración:** revisa las dos variables en Vercel y ejecuta `configurar` en la hoja original.
- **Apps Script devolvió HTML:** verifica que copiaste la URL `/exec` de una implementación publicada como **Cualquier persona** y **Ejecutar como Yo**.
- **Una pregunta no avanza:** espera a que venza el reloj o pulsa **Revelar**; luego **Siguiente pregunta**.
- **Un participante no aparece:** comprueba su código, nombre único y si la sala todavía está en espera; espera algunos segundos por la caché.
- **Mensajes de demasiada carga / timeout:** aumenta el intervalo de sondeo en `public/app.js`, realiza una prueba con menos jugadores o migra a infraestructura más apropiada para tiempo real.

### Fuentes de límites y configuración

- Apps Script: [Cuotas oficiales](https://developers.google.com/apps-script/guides/services/quotas)
- Apps Script: [Servicio de bloqueo LockService](https://developers.google.com/apps-script/reference/lock)
- Apps Script: [Publicar una aplicación web](https://developers.google.com/apps-script/guides/web)
- Vercel: [Variables de entorno](https://vercel.com/docs/environment-variables)