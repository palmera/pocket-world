# Tiny World · Territorios

Actualización del 8 de septiembre de 2026.

## Un mundo que evoluciona

La dirección visual pasa a un diorama histórico y naturalista: madera, piedra, tejidos y vegetación de tonos sobrios. Hay habitantes articulados, fauna, navegación, cultivos, campamentos, talleres, mercados y molinos. Interactuás con el entorno; los habitantes actúan de forma autónoma.

Es un sandbox contemplativo, **no un RTS ni una simulación económica completa**: no hay órdenes individuales, combate, recursos que administrar ni ciudades con decisiones estratégicas.

El catálogo contiene **80 escenas distribuidas entre ocho ecosistemas**, construidas con modelos y comportamientos reutilizables. No son 80 animaciones únicas. Los asentamientos cambian de estructura, las actividades alternan trabajo y descanso, y las articulaciones se animan sin hacer saltar o deformar edificios enteros.

## Controles

- **Relieve:** elegí Elevar, Hundir o Suavizar; ajustá Radio y Fuerza; después arrastrá sobre el mundo. El efecto depende del ecosistema bajo el pincel, no solamente del color seleccionado. Cada gesto se puede deshacer.
- **Tiempo:** pausa, 1× o 3× desde el panel del mundo.
- **Densidad de vida:** Serena, Equilibrada o Abundante. Cambia la cantidad y separación de escenas sin borrar tus terrenos.
- Se conservan Bordes con cierre asistido, Balde, Pincel de franjas, deshacer/rehacer y mundo vacío. En computadora, mantené **Espacio** y arrastrá para mover la cámara. En modo Lápiz, el dedo controla únicamente la cámara.

### Efectos del relieve

| Ecosistema | Elevar | Hundir |
| --- | --- | --- |
| Pradera / Bosque | Montañas | Cráteres |
| Agua | Huracanes | Remolinos |
| Desierto | Dunas | Depresiones |
| Montaña | Cordilleras | Cráteres |
| Volcánico | Volcanes | Calderas |
| Humedal | Islas | Canales |
| Nieve | Glaciares | Grietas de hielo |

Son formas y fenómenos visuales estilizados, no una simulación física de clima o fluidos. El relieve tiene límites para mantener estable el mundo; si se alcanza el límite, Suavizar permite liberar espacio.

## Progreso y descubrimientos

Las etapas son Exploración, Asentamiento, Comunidad y Civilización; las siguientes aparecen a los 1, 3 y 8 minutos de tiempo del mundo.

Los cinco ecosistemas iniciales siguen disponibles. Los nuevos requieren **tanto tiempo acumulado como cambios en el mundo**:

| Descubrimiento | Tiempo del mundo | Cambios acumulados |
| --- | --- | --- |
| Bosque | 2 minutos | 3 |
| Humedal | 5 minutos | 8 |
| Nieve | 10 minutos | 15 |

El reloj avanza mientras Tiny World está visible, con terreno y sin pausa. A 3×, el tiempo del mundo avanza más rápido. **No hay evolución offline** ni se acumulan horas por dejar la pestaña suspendida. Los descubrimientos se conservan al comenzar otro mundo.

## Distribución y guardado

La población depende del área disponible, de la huella de cada modelo y de una separación compartida por habitantes, escenografía y escenas fronterizas. Cortar un territorio en muchas áreas pequeñas no multiplica automáticamente sus habitantes. Las pendientes pronunciadas y los lugares con poco apoyo se evitan para reducir edificios flotantes y superposiciones.

Los modelos usan geometría de bajo peso, agrupación de partes estáticas y articulaciones conservadas. El relieve no agrega vértices al grafo de regiones. La cantidad de escenas y de formas de relieve está acotada; no implica capacidad ilimitada ni una garantía de FPS en todos los dispositivos.

Se guardan localmente terreno, relieve, progreso y preferencias. Los mundos anteriores siguen siendo compatibles. No hay sincronización entre dispositivos ni cuenta en la nube.

## Preparación para futuros packs

El contenido está separado del editor mediante un registro y manifiestos versionados: ecosistema, etapa, paleta, modelo y comportamiento. Se validan identificadores y capacidades permitidas; los packs no ejecutan código ni descargan recursos arbitrarios.

Esta entrega deja la base programática para registrar y retirar packs de contenido. **Todavía no incluye una tienda, pagos, upsells, derechos de compra ni una interfaz para instalar packs.**
