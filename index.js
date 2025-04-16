require('dotenv').config();
const { google } = require('googleapis');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const http = require('http'); // Añadir esta línea

// Setup Telegram
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Setup Google Auth usando JWT directamente
let credentials;
if (process.env.GOOGLE_CREDENTIALS) {
  credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
} else {
  credentials = require('./credenciales.json');
}

const auth = new google.auth.JWT(
  credentials.client_email,
  null,
  credentials.private_key,
  ['https://www.googleapis.com/auth/calendar']
);

const calendar = google.calendar({ version: 'v3', auth });

// Función para crear un calendario para un usuario si no existe
async function getOrCreateCalendar(userId, userName) {
  // Intentamos encontrar un calendario existente para este usuario
  try {
    const response = await calendar.calendarList.list();
    const calendars = response.data.items;
    
    // Buscamos un calendario con el nombre del usuario
    const userCalendar = calendars.find(cal => 
      cal.summary === `Calendario de ${userName}` || 
      cal.description?.includes(`userId:${userId}`)
    );
    
    if (userCalendar) {
      console.log(`Calendario existente encontrado para ${userName}`);
      return userCalendar.id;
    }
    
    // Si no existe, creamos uno nuevo
    console.log(`Creando nuevo calendario para ${userName}`);
    const newCalendar = await calendar.calendars.insert({
      resource: {
        summary: `Calendario de ${userName}`,
        description: `Calendario creado por TuCalendarioBot para ${userName}. userId:${userId}`,
        timeZone: process.env.DEFAULT_TIMEZONE || 'America/Argentina/Buenos_Aires'
      }
    });
    
    // Hacer el calendario público (solo lectura)
    try {
      // Hacer el calendario completamente público
      await calendar.acl.insert({
        calendarId: newCalendar.data.id,
        resource: {
          role: 'reader',
          scope: {
            type: 'default'
          }
        }
      });
      console.log('Calendario configurado como público (solo lectura)');
      
      // También dar permisos al propietario del bot
      if (process.env.USER_EMAIL) {
        await calendar.acl.insert({
          calendarId: newCalendar.data.id,
          resource: {
            role: 'owner',
            scope: {
              type: 'user',
              value: process.env.USER_EMAIL
            }
          }
        });
        console.log(`Permisos de propietario otorgados a ${process.env.USER_EMAIL}`);
      }
      
      // Añadir el calendario a la lista de calendarios de la cuenta de servicio
      try {
        await calendar.calendarList.insert({
          resource: {
            id: newCalendar.data.id
          }
        });
        console.log('Calendario añadido a la lista de calendarios');
      } catch (listError) {
        console.error('Error al añadir calendario a la lista:', listError);
      }
    } catch (shareError) {
      console.error('Error al configurar permisos del calendario:', shareError);
    }
    
    return newCalendar.data.id;
  } catch (error) {
    console.error('Error al obtener/crear calendario:', error);
    throw error;
  }
}

// Escuchar mensajes de Telegram
bot.on('text', async (ctx) => {
  const message = ctx.message.text;
  const userId = ctx.message.from.id;
  const userName = ctx.message.from.first_name || 'Usuario';

  // Enviar a Wit.ai
  const response = await axios.get(`https://api.wit.ai/message?v=20230514&q=${encodeURIComponent(message)}`, {
    headers: { Authorization: `Bearer ${process.env.WIT_AI_TOKEN}` }
  });

  const entities = response.data.entities;
  const intent = response.data.intents[0]?.name || 'none';

  if (intent === 'create_reminder') {
    const dateEntity = entities['wit$datetime:datetime']?.[0];
    const date = dateEntity?.value;
    
    // Extraer solo la tarea del mensaje, eliminando referencias a fechas y horas
    let tarea = message;
    // Si hay una fecha/hora en el mensaje, intentamos extraer solo la tarea
    if (dateEntity && dateEntity.body) {
      tarea = message.replace(dateEntity.body, '').trim();
      // Eliminar palabras comunes como "recordarme", "acordarme", etc.
      tarea = tarea.replace(/^(recordarme|acordarme|haceme acordar|recordatorio|agendar|anotar)\s+(de|para|que|a)?\s+/i, '');
    }

    if (date) {
      try {
        // Usamos un calendario fijo para todos los usuarios
        const calendarId = 'primary';
        
        // Configurar la zona horaria correcta para Argentina
        const timeZone = 'America/Argentina/Buenos_Aires';
        
        // Extraer la hora exacta del mensaje con un patrón más amplio
        const horaMatch = message.match(/(\d{1,2})(?::(\d{1,2}))?\s*(?:hs|hrs|horas|h|:)/i);
        console.log("Hora detectada en el texto:", horaMatch ? horaMatch[0] : "No detectada");
        
        // Obtener fecha base de Wit.ai
        const baseDate = new Date(date);
        console.log("Fecha base de Wit.ai:", baseDate.toISOString());
        
        // Si se detectó un día de la semana específico, ajustar la fecha
        let year = baseDate.getFullYear();
        let month = baseDate.getMonth();
        let day = baseDate.getDate();
        
        if (diaSemanaMatch) {
          const nombreDia = diaSemanaMatch[0].toLowerCase();
          // Mapear nombres de días a números (0 = domingo, 1 = lunes, etc.)
          const diasSemana = {
            'domingo': 0,
            'lunes': 1,
            'martes': 2,
            'miércoles': 3,
            'miercoles': 3,
            'jueves': 4,
            'viernes': 5,
            'sábado': 6,
            'sabado': 6
          };
          
          const diaObjetivo = diasSemana[nombreDia];
          if (diaObjetivo !== undefined) {
            // Obtener la fecha actual
            const hoy = new Date();
            // Crear una fecha para el próximo día de la semana especificado
            const fechaObjetivo = new Date(hoy);
            const diaActual = fechaObjetivo.getDay();
            
            // Calcular días hasta el próximo día de la semana especificado
            let diasHasta = diaObjetivo - diaActual;
            if (diasHasta <= 0) {
              diasHasta += 7; // Si ya pasó este día de la semana, ir al próximo
            }
            
            fechaObjetivo.setDate(fechaObjetivo.getDate() + diasHasta);
            
            // Actualizar año, mes y día
            year = fechaObjetivo.getFullYear();
            month = fechaObjetivo.getMonth();
            day = fechaObjetivo.getDate();
            
            console.log(`Fecha ajustada al próximo ${nombreDia}:`, fechaObjetivo.toISOString());
          }
        }
        
        // Establecer la hora exacta que el usuario especificó
        let hora, minutos;
        
        // PRIORIDAD MÁXIMA: Si se detectó una hora específica en el texto
        if (horaMatch) {
          hora = parseInt(horaMatch[1]);
          minutos = horaMatch[2] ? parseInt(horaMatch[2]) : 0;
          console.log(`Hora específica detectada en el texto: ${hora}:${minutos}`);
          
          // Verificar si la hora es válida
          if (isNaN(hora) || hora > 23) {
            console.log(`Hora inválida (${hora}), usando valor predeterminado`);
            hora = 9; // Valor predeterminado si la hora es inválida
          }
          
          // Verificar si los minutos son válidos
          if (isNaN(minutos) || minutos > 59) {
            console.log(`Minutos inválidos (${minutos}), usando 0`);
            minutos = 0;
          }
        } else {
          // Si no hay hora específica en el texto, usar la de Wit.ai
          hora = baseDate.getHours();
          minutos = baseDate.getMinutes();
          console.log(`No se detectó hora específica, usando hora de Wit.ai: ${hora}:${minutos}`);
        }
        
        // Verificar si la hora está en formato 12h con AM/PM
        const ampmMatch = message.match(/(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)/i);
        if (ampmMatch) {
          hora = parseInt(ampmMatch[1]);
          minutos = ampmMatch[2] ? parseInt(ampmMatch[2]) : 0;
          
          // Ajustar para PM
          if (ampmMatch[3].toLowerCase() === 'pm' && hora < 12) {
            hora += 12;
          }
          // Ajustar para AM
          if (ampmMatch[3].toLowerCase() === 'am' && hora === 12) {
            hora = 0;
          }
          
          console.log(`Hora ajustada por formato AM/PM: ${hora}:${minutos}`);
        }
        
        // Verificar si hay referencias a la mañana, tarde o noche
        if (message.match(/mañana|manana/i) && !message.match(/pasado\s+mañana|pasado\s+manana/i) && hora < 12) {
          // Si menciona "mañana" (no "pasado mañana") y la hora es < 12, mantener la hora
          console.log("Referencia a la mañana detectada, manteniendo hora de la mañana");
        } else if (message.match(/tarde/i) && hora < 12 && !horaMatch) {
          // Si menciona "tarde" y la hora es < 12 (y no fue explícitamente especificada), ajustar a la tarde
          hora += 12;
          console.log(`Hora ajustada para la tarde: ${hora}:${minutos}`);
        } else if (message.match(/noche/i) && hora < 12 && !horaMatch) {
          // Si menciona "noche" y la hora es < 12 (y no fue explícitamente especificada), ajustar a la noche
          hora += 12;
          console.log(`Hora ajustada para la noche: ${hora}:${minutos}`);
        }
        
        // Verificar si la hora tiene sentido
        if (hora > 23) {
          hora = 23;
          console.log("Hora ajustada a 23 (máximo)");
        }
        
        console.log("HORA FINAL DECIDIDA:", hora, ":", minutos);
        
        // Mejorar la extracción de la tarea
        let tarea = message;
        
        // Si hay una fecha/hora en el mensaje, intentamos extraer solo la tarea
        if (dateEntity && dateEntity.body) {
          // Eliminar la parte de fecha/hora
          tarea = message.replace(dateEntity.body, '').trim();
        }
        
        // Eliminar palabras y frases comunes al inicio (lista ampliada)
        const frasesComunes = [
          /^(recordarme|acordarme|haceme acordar|recordatorio|agendar|anotar|recordame|recordar)\s+(de|para|que|a)?\s+/i,
          /^(que)?\s+(tengo|debo|hay|necesito)?\s+(que)?\s+/i,
          /^(me\s+)?(podrias|podes|puedes|podés)?\s+(recordar|anotar|agendar)?\s+/i,
          /^(no\s+)?(me\s+)?(olvide|olvides|olvidar|olvidemos)\s+(de)?\s+/i,
          /^(tengo|hay|necesito)\s+/i,
          /^(por\s+favor\s+)?/i
        ];
        
        // Aplicar todas las expresiones regulares para limpiar la tarea
        frasesComunes.forEach(regex => {
          tarea = tarea.replace(regex, '');
        });
        
        // Eliminar referencias a horas que puedan haber quedado
        if (horaMatch) {
          tarea = tarea.replace(horaMatch[0], '').trim();
        }
        
        // Eliminar referencias a días de la semana que puedan haber quedado
        if (diaSemanaMatch) {
          tarea = tarea.replace(diaSemanaMatch[0], '').trim();
        }
        
        // Eliminar palabras "a las" o "el día" que puedan haber quedado
        tarea = tarea.replace(/\b(a las|el día|el dia|este|esta|próximo|proximo|próxima|proxima)\b/gi, '').trim();
        
        // Eliminar espacios múltiples
        tarea = tarea.replace(/\s+/g, ' ').trim();
        
        // Capitalizar la primera letra de la tarea
        tarea = tarea.charAt(0).toUpperCase() + tarea.slice(1);
        
        console.log("Tarea extraída:", tarea);
        console.log("Hora final:", hora, ":", minutos);
        
        // Crear fecha con la hora exacta (en hora local de Argentina)
        const eventDate = new Date(year, month, day, hora, minutos, 0);
        console.log("Fecha y hora final del evento:", eventDate.toLocaleString('es-AR', { timeZone: timeZone }));
        
        // Crear cadenas de fecha/hora en formato ISO 8601 con offset de Argentina (-03:00)
        const formatoISO = (date) => {
          return date.getFullYear() + '-' +
                 String(date.getMonth() + 1).padStart(2, '0') + '-' +
                 String(date.getDate()).padStart(2, '0') + 'T' +
                 String(date.getHours()).padStart(2, '0') + ':' +
                 String(date.getMinutes()).padStart(2, '0') + ':00-03:00';
        };
        
        const startISO = formatoISO(eventDate);
        const endISO = formatoISO(new Date(eventDate.getTime() + 30 * 60000));
        
        console.log("Fecha ISO inicio:", startISO);
        console.log("Fecha ISO fin:", endISO);
        
        // Crear el evento con las fechas ISO explícitas
        const event = {
          summary: tarea,
          description: `Creado por TuCalendarioBot para ${userName}`,
          start: { 
            dateTime: startISO,
            timeZone: timeZone
          },
          end: { 
            dateTime: endISO,
            timeZone: timeZone
          },
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'popup', minutes: 30 }
            ]
          },
          visibility: 'public'
        };

        const createdEvent = await calendar.events.insert({
          calendarId: calendarId,
          resource: event,
        });
        
        // Formatear la fecha para mostrarla en el mensaje
        const options = {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        };
        
        const timeOptions = {
          hour: '2-digit',
          minute: '2-digit',
        };
        
        // Obtener la fecha formateada y capitalizar el día de la semana
        let fechaFormateada = eventDate.toLocaleDateString('es-AR', options);
        // Asegurar que el día de la semana comience con mayúscula
        fechaFormateada = fechaFormateada.charAt(0).toUpperCase() + fechaFormateada.slice(1);
        
        // Formatear la hora por separado
        const horaFormateada = eventDate.toLocaleTimeString('es-AR', timeOptions);
        
        // Formatear fechas para el enlace de Google Calendar
        const formatoEnlace = (date) => {
          return date.getFullYear() +
                 String(date.getMonth() + 1).padStart(2, '0') +
                 String(date.getDate()).padStart(2, '0') + 'T' +
                 String(date.getHours()).padStart(2, '0') +
                 String(date.getMinutes()).padStart(2, '0') + '00';
        };
        
        const startForLink = formatoEnlace(eventDate);
        const endForLink = formatoEnlace(new Date(eventDate.getTime() + 30 * 60000));
        
        // Crear un enlace optimizado para dispositivos móviles que abra directamente la app
        const calendarLink = `https://www.google.com/calendar/event?action=TEMPLATE&text=${encodeURIComponent(tarea)}&details=${encodeURIComponent(`Creado por TuCalendarioBot`)}&dates=${startForLink}/${endForLink}&ctz=${encodeURIComponent(timeZone)}&output=mobile`;

        // Crear mensaje con el enlace optimizado para móviles
        const replyMessage = `✅ Evento "${tarea}"\n📅 Creado para: ${fechaFormateada}\n🕒 Horario: ${horaFormateada}\n\n📱 Toca el siguiente enlace para agregar este evento a tu calendario:\n${calendarLink}\n\n⏰ El evento incluye un recordatorio 30 minutos antes.`;
        
        ctx.reply(replyMessage);
      } catch (err) {
        console.error('Error completo:', err);
        ctx.reply('❌ Error al crear el evento: ' + err.message);
      }
    } else {
      ctx.reply('❌ No pude entender la fecha/hora del evento.');
    }
  } else {
    ctx.reply('No entendí qué querés hacer. ¿Querés que agende algo?');
  }
});

// Iniciar bot
bot.launch();
console.log('🤖 Bot en marcha...');

// Manejo de cierre adecuado
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Crear un servidor HTTP simple para mantener la aplicación en ejecución en Render
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.write('<h1>TuCalendarioBot está activo</h1><p>El bot de Telegram está funcionando correctamente.</p>');
  res.end();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor HTTP escuchando en el puerto ${PORT}`);
});

// Función para mantener el servicio activo
function keepAlive() {
  // URL de tu servicio en Render
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  
  // Hacer una petición a tu propio servidor cada 14 minutos
  setInterval(() => {
    http.get(url, (res) => {
      console.log(`Ping enviado. Estado: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error('Error al enviar ping:', err.message);
    });
  }, 14 * 60 * 1000); // 14 minutos en milisegundos
}

// Iniciar el mecanismo de keep-alive
keepAlive();
