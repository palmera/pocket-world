# Pocket World

Dibujá, pintá y descubrí pequeños mundos sobre una esfera 3D.

**Jugar:** https://palmera.github.io/pocket-world/

Repositorio independiente de Ball Panel Studio. Incluye Tiny Pocket World, Jelly y los modos de dibujo.

## Desarrollo local

Requiere Node.js 22 y npm.

```sh
npm ci
npm run dev
```

## Comprobaciones

```sh
npm test
npm run build
```

## Publicación

Cada push a `main` ejecuta las pruebas, compila y publica `dist/` en GitHub Pages mediante `.github/workflows/deploy.yml`. No se suben dependencias, archivos personales ni configuraciones secretas.

El mundo se guarda en el navegador de cada dispositivo; no se sincroniza automáticamente entre dispositivos. La URL de juego funciona sin mantener encendida la computadora de desarrollo.

## Controles

- **Move:** girar y acercar el planeta.
- **Borders:** elegir terreno y cerrar un contorno o dividir una zona; la nueva región recibe el terreno elegido. En un corte abierto se elige la porción más pequeña.
- **Land:** pintar una región existente. Regiones iguales que comparten arista se unen.
- Deshacer, rehacer y guardar una imagen desde la barra de acciones.
