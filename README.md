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
npm run benchmark
```

La prueba de carga mide 20 círculos y la construcción/reutilización de un mundo con 12 áreas internas. Los tiempos dependen del equipo; no son una medición de FPS ni un presupuesto garantizado para iPad. Las pruebas automáticas cubren regiones grandes, edición incremental, pintura, liberación de recursos y recuperación ante fallos.

Cada edición descarta candidatos lejanos antes de calcular intersecciones exactas y reutiliza geometrías y modelos que no cambiaron. Las cachés conservan solo el mundo actual; no simplifican el dibujo ni acumulan todos los estados anteriores. Todavía se reconstruyen las líneas y parte de los objetos de escena: el costo no es independiente del tamaño del mundo.

## Publicación

Cada push a `main` ejecuta las pruebas, compila y publica `dist/` en GitHub Pages mediante `.github/workflows/deploy.yml`. No se suben dependencias, archivos personales ni configuraciones secretas.

El mundo se guarda en el navegador de cada dispositivo; no se sincroniza automáticamente entre dispositivos. La URL de juego funciona sin mantener encendida la computadora de desarrollo.

## Controles

- **Move:** girar y acercar el planeta.
- **Borders:** elegir terreno y cerrar un contorno o dividir una zona; la nueva región recibe el terreno elegido. En un corte abierto se elige la porción más pequeña.
- **Balde:** rellenar una región existente. Regiones iguales que comparten arista se unen.
- **Pincel:** pintar una franja con el color elegido, con grosor de 12–60 px. La franja se ve durante el gesto; al soltar se incorpora como terreno editable. Un círculo de pincel pinta un anillo, no rellena su centro. Un toque pinta un punto.
- Los trazos se calculan en un Web Worker. Mientras aparece “Incorporando trazo…” la cámara sigue disponible; esperá a que termine para editar otra vez. Deshacer durante ese cálculo cancela el trazo pendiente. El armado final de la escena aún ocurre en la interfaz y puede tardar en mundos grandes.
- **Jelly:** los límites entre colores son depresiones con un perfil suave de menisco, no tubos elevados. Es una representación visual de tensión superficial, no una simulación de fluidos.
- Deshacer, rehacer y guardar una imagen desde la barra de acciones.
- **Tiny desde cero:** borra terrenos, bordes y habitantes después de confirmar. El planeta sigue en modo Tiny, listo para dibujar, y permanece vacío al recargar. Deshacer recupera el mundo anterior durante la sesión; recargar cierra ese historial.
- **Mano / Lápiz:** en Mano, el dedo usa la herramienta elegida. En Lápiz, los dedos sobre el planeta solo giran o acercan la cámara; el Apple Pencil dibuja o pinta. Move sigue moviendo la cámara también con el lápiz. La preferencia queda guardada por navegador.
- Si empezás a mover la cámara mientras dibujás, el trazo pendiente se cancela. Levantá el lápiz y los dedos antes de comenzar otro trazo. Los botones de la interfaz siguen funcionando con el dedo.
