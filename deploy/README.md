# Despliegue con Docker

Guía para publicar **torneo-dota** en un VPS que ya tiene Caddy en Docker. La imagen se construye **dentro de Docker** a partir del repositorio de GitHub: en el servidor no se instala node, npm ni git.

**Resultado:** <https://torneo-dota.jpsolutions.app> sirviendo la app, con los datos en un volumen que sobrevive a reinicios, caídas y actualizaciones.

> **Advertencia sobre los datos.** La base de datos SQLite vive en el volumen `torneo-dota_data`.
> **`docker compose down -v` (o `docker volume rm torneo-dota_data`) BORRA TODOS LOS DATOS.**
> Usa siempre `docker compose down` sin `-v`, y haz copias de seguridad (ver más abajo).

## Archivos

| Archivo | Para qué sirve |
| --- | --- |
| `compose.yml` | Compose de producción (VPS): construye desde GitHub, red `mbd_edge`, sin puertos publicados |
| `compose.local.yml` | Compose para pruebas locales: construye desde este checkout y publica solo en `127.0.0.1` |
| `.env.example` | Plantilla de variables de entorno (se copia como `.env`) |
| `_torneo-dota.caddy` | Bloque de sitio para el Caddy existente |

## Requisitos del servidor

- Docker CE con Compose v2 y BuildKit (incluido en Docker CE moderno).
- Caddy en Docker con la red externa `mbd_edge`, que importa `/etc/caddy/sites/*.caddy` (host: `/opt/mbd/caddy-sites/`) y define el snippet `(common)`.
- El DNS de `torneo-dota.jpsolutions.app` apuntando al VPS (ya cubierto por el comodín).

## Primer despliegue

1. **Crea la carpeta del proyecto** y copia los archivos de despliegue (desde tu equipo con `scp`, o pegándolos):

   ```bash
   mkdir -p ~/torneo-dota && cd ~/torneo-dota
   # copia aquí deploy/compose.yml, deploy/.env.example y deploy/_torneo-dota.caddy
   cp .env.example .env
   chmod 600 .env
   ```

2. **Revisa `.env`.** Los valores por defecto sirven; lo habitual es dejar `ADMIN_SETUP_TOKEN` y `ADMIN_PASSWORD` vacíos (ver el paso 4). `PUBLIC_BASE_URL` debe ser la URL pública real: las vistas previas al compartir (WhatsApp, Telegram, Discord) la usan para sus enlaces absolutos.

3. **Construye y arranca:**

   ```bash
   docker compose up -d --build
   docker compose ps          # debe pasar a "healthy" en unos segundos
   ```

4. **Obtén el código de configuración inicial** (solo la primera vez, mientras no exista ningún administrador):

   ```bash
   docker compose logs torneo-dota
   # Setup required: open /admin/setup and use code: <código>
   ```

   Alternativa: define `ADMIN_PASSWORD` en `.env` antes del primer arranque y se creará el usuario `admin` con esa contraseña.

5. **Publica el sitio en Caddy** (requiere `sudo`):

   ```bash
   sudo cp _torneo-dota.caddy /opt/mbd/caddy-sites/torneo-dota.caddy
   docker exec mbd-caddy caddy reload --config /etc/caddy/Caddyfile
   ```

   `flush_interval -1` es necesario para que las actualizaciones en vivo (SSE) lleguen al instante.

6. **Comprueba que el contenedor está en la red de Caddy:**

   ```bash
   docker network inspect mbd_edge | grep -A3 torneo-dota
   ```

7. **Abre <https://torneo-dota.jpsolutions.app/admin>**, crea el administrador con el código del paso 4 y configura el torneo.

## Imágenes de los equipos (Cloudflare R2)

Cada equipo puede subir su propia imagen, que reemplaza a su héroe en toda la web. Las imágenes viven en un bucket de Cloudflare R2 (no en el VPS). **Sin esta configuración, en producción las imágenes personalizadas quedan desactivadas** (el panel lo avisa y los héroes siguen funcionando).

1. **Crea el bucket.** En el panel de Cloudflare: *R2 Object Storage > Create bucket*. Nombre sugerido: `torneo-dota`.
2. **Activa el acceso público de lectura**, con una de estas dos opciones:
   - *Dominio de desarrollo r2.dev*: en el bucket, *Settings > Public access > R2.dev subdomain > Allow Access*. Te da una URL `https://pub-xxxxxxxx.r2.dev`. Es lo más rápido, pero Cloudflare lo limita en tráfico y no es para producción con mucho público.
   - *Dominio propio* (recomendado): *Settings > Custom Domains > Connect Domain*, por ejemplo `img.jpsolutions.app` (la zona debe estar en Cloudflare).
3. **Crea un token de API** solo para este bucket: *R2 Object Storage > Manage API tokens > Create API token*, permiso **Object Read & Write**, y en *Specify bucket(s)* elige únicamente `torneo-dota`. Copia el *Access Key ID* y el *Secret Access Key* (el secreto se muestra una sola vez). El *Account ID* aparece en la misma página de R2.
4. **Rellena `.env`** (las cinco variables son obligatorias juntas; si falta alguna, el servidor no arranca y dice cuáles):

   ```bash
   R2_ACCOUNT_ID=<tu account id>
   R2_ACCESS_KEY_ID=<access key id>
   R2_SECRET_ACCESS_KEY=<secret access key>
   R2_BUCKET=torneo-dota
   R2_PUBLIC_BASE_URL=https://img.jpsolutions.app   # o https://pub-xxxxxxxx.r2.dev, sin barra final
   ```

5. **Reinicia** con `docker compose up -d`. El registro debe decir `Team images: Cloudflare R2 bucket "torneo-dota"`.

- El servidor convierte cada imagen a WebP (512×288 y 1024×576), les pone `Cache-Control: public, max-age=31536000, immutable` y usa una clave nueva en cada cambio, así que reemplazar una imagen nunca deja copias viejas en caché. Al reemplazar o quitar la imagen, o al eliminar el equipo, se borran los archivos anteriores.
- El token solo puede leer y escribir en ese bucket. Para rotarlo, crea uno nuevo, cambia `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY` y reinicia.
- **Alternativa sin R2:** `IMAGE_STORE=local` guarda las imágenes en el volumen (`/data/uploads`) y las sirve la propia app. Quedan incluidas en la copia de seguridad del volumen, pero sin CDN.

## Actualizar

```bash
cd ~/torneo-dota
docker compose build --pull && docker compose up -d
```

- Docker recrea el contenedor con la imagen nueva; el volumen y sus datos no se tocan.
- Las migraciones de la base se aplican solas al arrancar (solo hacia adelante).
- La imagen se construye desde la rama `main` de GitHub; para construir una versión concreta, ver *Volver a una versión anterior*.

## Volver a una versión anterior

Edita `build.context` en `compose.yml` para apuntar a un commit o etiqueta en lugar de la rama:

```yaml
context: https://github.com/JorgeLBJ/torneo-dota.git#<sha-del-commit>
```

y ejecuta `docker compose build && docker compose up -d`. Ojo: si esa versión es anterior a una migración ya aplicada, la base de datos queda más nueva que el código; restaura antes una copia de seguridad hecha con esa versión.

## Seguridad de los datos

| Situación | Efecto sobre los datos |
| --- | --- |
| `docker compose restart` / `stop` / `start` | Se conservan |
| `docker compose down` (sin `-v`) y luego `up -d` | Se conservan |
| Caída del contenedor o del servidor (`kill -9`, corte de luz) | Se conservan: SQLite en modo WAL recupera lo confirmado |
| Recrear la imagen (`build` + `up -d`) | Se conservan |
| **`docker compose down -v`** | **Se pierden** |

- Los datos están en el volumen con nombre `torneo-dota_data`, montado en `/data` (`DATABASE_PATH=/data/torneos.db`).
- Al parar el contenedor (`SIGTERM`) la app deja de aceptar conexiones, cierra los flujos en vivo y cierra la base de datos, de modo que el WAL queda consolidado. `stop_grace_period` es de 20 s; en la práctica tarda menos de un segundo.
- El proceso corre como usuario no privilegiado (`node`).

## Copias de seguridad

**Copia consistente con la app en marcha** (usa la API de copia de SQLite dentro del propio contenedor):

```bash
mkdir -p ~/backups
docker exec torneo-dota node -e "const D=require('better-sqlite3');const d=new D('/data/torneos.db');d.backup('/data/backup.db').then(()=>{d.close();console.log('copia lista')})"
docker cp torneo-dota:/data/backup.db ~/backups/torneos-$(date +%F).db
docker exec torneo-dota rm -f /data/backup.db
```

**Copia del volumen completo** (con la app detenida):

```bash
docker compose stop
docker run --rm -v torneo-dota_data:/data -v ~/backups:/backup alpine tar czf /backup/torneo-dota-data-$(date +%F).tgz -C /data .
docker compose start
```

**Restaurar** una copia `.db` (borra la base actual):

```bash
docker compose stop
docker run --rm -v torneo-dota_data:/data -v ~/backups:/backup alpine sh -c \
  'rm -f /data/torneos.db /data/torneos.db-wal /data/torneos.db-shm && cp /backup/torneos-AAAA-MM-DD.db /data/torneos.db && chown 1000:1000 /data/torneos.db'
docker compose start
```

Para restaurar un `.tgz`, vacía el volumen y descomprime: `rm -rf /data/* && tar xzf /backup/<archivo>.tgz -C /data` (dentro del mismo tipo de contenedor `alpine`).

> Guarda las copias **fuera** del VPS con regularidad: un volumen no es una copia de seguridad.

## Pruebas locales con Docker

```bash
docker compose -f deploy/compose.local.yml up -d --build   # http://127.0.0.1:3097
docker compose -f deploy/compose.local.yml logs torneo-dota # código de configuración inicial
docker compose -f deploy/compose.local.yml down -v          # limpia SOLO el volumen de prueba
```

Usa proyecto, contenedor y volumen propios (`torneo-dota-local`), así que no toca el despliegue real. El puerto se cambia con `LOCAL_PORT`.

## Solución de problemas

| Síntoma | Causa probable y solución |
| --- | --- |
| Caddy responde 502 | El contenedor no está en `mbd_edge` o no está sano. Revisa `docker network inspect mbd_edge` y `docker compose ps` |
| Tras recrear el contenedor Caddy no lo encuentra | Comprueba que sigue conectado a `mbd_edge`; `docker compose up -d` lo vuelve a conectar (la red está declarada en `compose.yml`) |
| Al compartir el enlace se ve una vista previa vieja | Las redes guardan la vista previa en caché. La imagen lleva `?v=` con su huella, así que cambia sola cuando cambia el archivo; para el texto, vuelve a pedirla con el depurador de Facebook/Meta o espera unos días |
| La página no se actualiza en vivo | Falta `flush_interval -1` en el bloque de Caddy o hay otro proxy que hace buffering. Recarga Caddy tras corregirlo |
| Twitch no se reproduce dentro de Google Sites | Añade el host que incrusta la página (por ejemplo un subdominio de `googleusercontent.com`) a `STREAM_PARENT_HOSTS` en `.env` y ejecuta `docker compose up -d` |
| El reproductor no aparece | Un bloqueador de anuncios puede bloquearlo; la pestaña "En vivo" ofrece abrir el canal en su plataforma |
| No aparece el código de configuración | Solo se imprime mientras no haya administradores. Consulta `docker compose logs torneo-dota` desde el arranque; si ya existe un administrador, `/admin/setup` responde 404 |
| `docker compose build` no encuentra la rama | El repositorio debe ser accesible públicamente y `main` debe contener el `Dockerfile` |

Comandos útiles: `docker compose logs -f torneo-dota` (registros), `docker compose ps` (estado y salud) y, para consultar la salud a mano, `docker exec torneo-dota node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>r.text()).then(console.log)"`.
