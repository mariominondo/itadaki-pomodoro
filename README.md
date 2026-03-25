# 🍅 Itadaki Pomodoro

Gestor de proyectos con temporizador Pomodoro, persistencia en archivo JSON (NoSQL local) y estadísticas visuales.

![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Python](https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white)

## Características

- **Proyectos** — Crear, editar, archivar y restaurar proyectos
- **Temporizador Pomodoro** — Work / Break con duración configurable por proyecto
- **Descanso Rápido** — Botón global para pausar todo e iniciar un break
- **Historial** — Registro automático de sesiones (inicio, pausa, completado, detenido)
- **Entrada Manual** — Agregar tiempo retroactivamente
- **Timeline** — Barra visual del día con segmentos de trabajo y descanso
- **Estadísticas** — Gráfica de barras (Chart.js) con filtros por fecha
- **Persistencia** — Archivo JSON en servidor + localStorage como fallback
- **Notificaciones** — Sonido + notificaciones del navegador al terminar
- **Export / Import** — Backup y restauración vía archivo JSON

## Inicio Rápido

### Windows
```
start_pomodoro.bat
```

### Linux / Mac
```bash
python3 server.py
# Abrir http://localhost:8000
```

El servidor crea automáticamente `pomodoro_data.json` en la primera ejecución.

## Estructura

```
itadaki_Pomodoro/
├── index.html                    # UI principal
├── app.js                        # Lógica del cliente
├── style.css                     # Estilos
├── server.py                     # Servidor HTTP + persistencia JSON
├── start_pomodoro.bat            # Launcher (Windows)
├── pomodoro_data.json            # Datos persistidos (gitignored)
├── pomodoro_data.example.json    # Plantilla de referencia
└── assets/
    ├── logo.svg
    └── favicon.svg
```

## Persistencia

| Capa | Mecanismo | Propósito |
|------|-----------|-----------|
| Primaria | `pomodoro_data.json` vía `server.py` | Datos persistentes entre sesiones |
| Fallback | `localStorage` del navegador | Backup si el servidor no está disponible |

El indicador de conexión (círculo en el header) muestra:
- 🟢 Verde — Servidor conectado, datos se guardan en archivo
- 🔴 Rojo — Sin servidor, usando solo localStorage (click para reconectar)

## Requisitos

- Python 3.x (para el servidor)
- Navegador moderno (Chrome, Firefox, Edge)

## Contributing

¡Contribuciones bienvenidas! Este proyecto es ideal para tu primer PR. 🎉

### Setup

```bash
git clone https://github.com/mariominondo/itadaki-pomodoro.git
cd itadaki-pomodoro
python3 server.py
# Abrir http://localhost:8000
```

### Cómo contribuir

1. Haz fork del repositorio
2. Crea tu rama: `git checkout -b feature/mi-mejora`
3. Haz tus cambios y commitea: `git commit -m "feat: descripcion breve"`
4. Push a tu fork: `git push origin feature/mi-mejora`
5. Abre un Pull Request describiendo tus cambios

### Ideas para tu primer PR

| Dificultad | Idea |
|------------|------|
| 🟢 Fácil | Agregar temas de color (dark/light toggle manual) |
| 🟢 Fácil | Mejorar mensajes de toast con iconos |
| 🟢 Fácil | Agregar favicon.ico para compatibilidad con más navegadores |
| 🟡 Media | Agregar sonidos personalizables para la alarma |
| 🟡 Media | Drag & drop para reordenar proyectos |
| 🟡 Media | Exportar estadísticas como imagen PNG |
| 🔴 Avanzada | PWA con service worker para uso offline |
| 🔴 Avanzada | Sincronización entre dispositivos via WebSocket |

### Convenciones

- **Commits**: Usar [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `docs:`, `style:`
- **Idioma del código**: Variables y comentarios en inglés, UI en español
- **Sin dependencias extras**: El proyecto es vanilla HTML/CSS/JS, mantenerlo así

## Licencia

MIT
