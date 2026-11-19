# Amigo invisible

Ingresá un nombre por línea y elegí **Dar de alta el sorteo**. Compartí el enlace generado con el grupo. Cada participante elige su nombre y pulsa **Ver amigo invisible**. El enlace conserva las asignaciones al abrirlo en otro dispositivo.

El enlace contiene los nombres y las asignaciones. Cualquiera que lo tenga puede seleccionar cualquier participante. Guardá una copia del enlace para volver al mismo sorteo.

## Vista local

Desde esta carpeta, ejecutá `python -m http.server 8000 --directory public` y abrí http://localhost:8000. Los enlaces que generes en localhost sirven para probar en tu equipo. Para el grupo, generá el sorteo desde la URL pública.

## Firebase Hosting

Con Firebase CLI instalada y una cuenta de Google autorizada:

1. Ejecutá `firebase login`.
2. Verificá que tu cuenta tenga acceso al proyecto `amigo-invisible-b52dd` con `firebase projects:list`.
3. Publicá con `firebase deploy --only hosting`. El proyecto predeterminado se define en `.firebaserc`.

El sitio es estático y no requiere base de datos ni autenticación para jugar.
