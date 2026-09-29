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

2. **Revisa `.env`.** Los valores por defecto sirven; lo habitual es dejar `ADMIN_SETUP_TOKEN` y `ADMIN_PASSWORD` vacíos (ver el paso 4).

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
| La página no se actualiza en vivo | Falta `flush_interval -1` en el bloque de Caddy o hay otro proxy que hace buffering. Recarga Caddy tras corregirlo |
| Twitch no se reproduce dentro de Google Sites | Añade el host que incrusta la página (por ejemplo un subdominio de `googleusercontent.com`) a `STREAM_PARENT_HOSTS` en `.env` y ejecuta `docker compose up -d` |
| El reproductor no aparece | Un bloqueador de anuncios puede bloquearlo; la pestaña "En vivo" ofrece abrir el canal en su plataforma |
| No aparece el código de configuración | Solo se imprime mientras no haya administradores. Consulta `docker compose logs torneo-dota` desde el arranque; si ya existe un administrador, `/admin/setup` responde 404 |
| `docker compose build` no encuentra la rama | El repositorio debe ser accesible públicamente y `main` debe contener el `Dockerfile` |

Comandos útiles: `docker compose logs -f torneo-dota` (registros), `docker compose ps` (estado y salud) y, para consultar la salud a mano, `docker exec torneo-dota node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>r.text()).then(console.log)"`.
