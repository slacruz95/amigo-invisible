# Amigo invisible

1. Abrí la app, ingresá tu nombre y guardá tu enlace personal. El inicio reconoce a quienes ya se registraron en ese navegador.
2. Para administrar, abrí `/#admin` o ingresá como `admin1`. Cualquiera que use esa dirección o ese nombre puede acceder al panel. Marcá quiénes participan y lanzá el sorteo.
3. Podés cambiar la selección y lanzar otra ronda. Al publicarla se reemplazan las asignaciones y el enlace de auditoría. El enlace de auditoría muestra las comprobaciones y quién le regala a quién. Compartilo solo con quien vaya a verificar la ronda.

La versión publicada usa sesiones anónimas de Firebase y Realtime Database para guardar los registros. Las reglas mantienen privados los enlaces personales y solo muestran una asignación a quien puede presentar su enlace. Los participantes entran por nombre y conservan su acceso a través del enlace personal. Los datos de prueba local están separados. Los enlaces del sistema de grupos anterior conservan su ruta.

## Firebase

El proyecto predeterminado es `amigo-invisible-b52dd`. Usa Firebase Hosting, Realtime Database y el proveedor de correo y contraseña de Firebase Authentication. La CLI obtiene la configuración web desde Hosting.

Para actualizar la app y las reglas, ejecutá `firebase deploy --only hosting,database` desde esta carpeta con una cuenta autorizada. Para habilitar los proveedores de autenticación en otro proyecto, usá `firebase deploy --only auth` con una versión de Firebase CLI que admita ese destino.

## Prueba local por nombre

Ejecutá `node local/server.mjs` y abrí http://127.0.0.1:5001. El usuario `admin1` abre el panel. La prueba local tiene su propio sorteo y guarda los datos en el equipo.

Para probar desde otros dispositivos de la misma red, ejecutá `node local/server.mjs --lan` y usá la dirección de red que aparece en la terminal. Los enlaces se generan con la dirección desde la cual abriste la app. Cualquiera con acceso a esa versión de prueba puede ingresar como `admin1`.
