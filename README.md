# Amigo invisible

1. Abrí la app y elegí **Crear grupo**. Copiá el enlace de inscripción y compartilo.
2. Cada persona escribe su nombre, se registra y guarda su enlace personal. Si vuelve en el mismo navegador, también puede usar el enlace de inscripción.
3. Cuando estén todos, pulsá **Lanzar sorteo**. Se cierra la inscripción y cada participante puede revelar su asignación en la app.
4. Si alguien pierde acceso, usá **Renovar enlace** en el panel y compartí el nuevo enlace solo con esa persona. El anterior queda invalidado.

El panel depende de la sesión anónima de Firebase. Abrilo desde el navegador donde creaste el grupo. El enlace personal de un participante da acceso a su asignación. No hay envío por correo ni WhatsApp.

## Firebase

El proyecto predeterminado es `amigo-invisible-b52dd`. Usa Firebase Hosting, Realtime Database y el proveedor anónimo de Firebase Authentication. La CLI obtiene la configuración web desde Hosting.

Para actualizar la app y las reglas, ejecutá `firebase deploy --only hosting,database` desde esta carpeta con una cuenta autorizada. Para habilitar el proveedor anónimo en otro proyecto, usá `firebase deploy --only auth` con una versión de Firebase CLI que admita ese destino.
