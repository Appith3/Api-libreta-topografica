import express from 'express';
import { collection, getDocs, query, orderBy, where, doc, getDoc } from 'firebase/firestore';
import xlsxPopulate from 'xlsx-populate';
import fs from 'fs';
import bodyParser from 'body-parser';
import cors from 'cors';

// TODO: implement firesbae storage
import { db } from './firebaseConfig.js';
import getCurrentDate from './utils/getCurrentDate.js';

const app = express();
const port = parseInt(process.env.PORT) || 8089;

app.use(bodyParser.json());

async function getProjectById(projectId) {
  if (!projectId || typeof projectId !== 'string') {
    console.error('ID del proyecto no válido');
    throw new Error('ID del proyecto no válido');
  }

  const projectRef = doc(collection(db, `${process.env.FIREBASE_ROOT_COLLECTION}`), projectId);
  const projectSnapshot = await getDoc(projectRef);

  if (!projectSnapshot.exists) {
    console.error('Proyecto no encontrado');
    throw new Error('Proyecto no encontrado');
  }

  return projectSnapshot.data();
}

async function getStationingData(projectId) {
  const project = await getProjectById(projectId);

  const stationingRef = collection(db, `${process.env.FIREBASE_ROOT_COLLECTION}/${projectId}/stationing`);
  const stationingQuery = query(stationingRef, where('is_complete', '==', true), orderBy('stationing_name', 'asc'));
  const stationingSnapshots = await getDocs(stationingQuery);

  return stationingSnapshots.docs.map(doc => {
    return {
      id: doc.id,
      ...doc.data(),
    };
  });
}

async function getStationingDetails(stationingId, projectId) {
  const detailsRef = collection(db, `${process.env.FIREBASE_ROOT_COLLECTION}/${projectId}/stationing/${stationingId}/details`);
  const detailsQuery = query(detailsRef, orderBy('distance', 'asc'));
  const detailsSnapshots = await getDocs(detailsQuery);

  return detailsSnapshots.docs.map(doc => doc.data());
}

app.use(cors({
  // origin: ['http://localhost:3000', 'https://your-production-app.com'], // List of allowed origins
  origin: '*',
  credentials: true, // Allow cookies to be sent with CORS requests
  methods: ['GET', 'POST', 'PUT', 'DELETE'], // Allowed HTTP methods
  allowedHeaders: ['Content-Type', 'Authorization', 'My-Custom-Header'], // Allowed request headers
}));

// TODO: write better response messages
app.post('/api/create-sections-file/', async (req, res) => {

  const projectId = req.query.id;

  try {
    const stationingData = await getStationingData(projectId);

    if (stationingData.length === 0) {
      console.error('No hay datos para crear el archivo');
      res.status(404).send('No hay datos para crear el archivo');
      return;
    }

    const sections = await Promise.all(stationingData.map(async (stationing) => {
      const details = await getStationingDetails(stationing.id, projectId);
      return {
        stationingName: stationing.stationing_name,
        code: stationing.code,
        centralReading: stationing.central_reading,
        notes: stationing.notes,
        details,
      };
    }));

    const workbook = await xlsxPopulate.fromBlankAsync();
    const printFormat = workbook.sheet(0).name('Formato');
    const drawFormat = workbook.addSheet('Secciones');

    let sectionsDrawFormat = []
    let sectionsPrintFormat = []

    for (const section of sections) {
      let { stationingName, code, details, notes } = section
      const rows = details.length + 1;

      if (notes) {
        console.log('la seecion tiene notas')
        sectionsPrintFormat.push([stationingName, , , 1000, code]);
        sectionsPrintFormat.push(notes)
        sectionsDrawFormat.push([stationingName, '']);
        sectionsDrawFormat.push([0, 0]);
      } else {
        // DrawFormat
        for (let row = 0; row < rows; row++) {
          if (row === 0 || details[row - 1] === -1) {
            sectionsDrawFormat.push([stationingName, '']);
            sectionsDrawFormat.push([0, 0]);
          } else {
            let { distance, slope } = details[row - 1];
            if (distance !== -1 || row === details.length) {
              sectionsDrawFormat.push([distance, slope])
            }
          }
        }
        // PrintFormat
        for (let row = 0; row < rows; row++) {
          if (row === 0 || details[row - 1] === -1) {
            sectionsPrintFormat.push([stationingName, , , 1000, code]);
          } else {
            const { detailName, distance, slope } = details[row - 1];

            if (distance !== -1 || row === details.length) {
              distance < 0
                ? sectionsPrintFormat.push([, distance, , slope, detailName])
                : sectionsPrintFormat.push([, , distance, slope, detailName])
            }
          }
        }
      }
    }

    printFormat.cell('A1').value(sectionsPrintFormat)
    drawFormat.cell('A1').value(sectionsDrawFormat)

    await workbook.toFileAsync(`./secciones_${projectId}.xlsx`);

    res.status(200).send('File created');
  } catch (error) {
    console.error(error);
    res.status(500).send({
      error,
      message: 'Error al crear el archivo'
    });
  }
});

app.post('/api/create-vegetation-file', async (req, res) => {
  const specimens = req.body;
  const currentDate = getCurrentDate()

  const workbook = await xlsxPopulate.fromBlankAsync();
  const sheet = workbook.sheet(0).name('hoja 1');
  let row = 0;

  for (const specimen of specimens) {
    const { classification, cup_diameter, height, id, trunk_diameter } = specimen;
    let cupDiameter = '-';
    let trunkDiameter = '-';

    if (cup_diameter) cupDiameter = cup_diameter;
    if (trunk_diameter) trunkDiameter = trunk_diameter;

    sheet.cell(`A${row + 1}`).value(Number(id));
    sheet.cell(`B${row + 1}`).value(classification);
    sheet.cell(`C${row + 1}`).value(height);
    sheet.cell(`D${row + 1}`).value(trunkDiameter);
    sheet.cell(`E${row + 1}`).value(cupDiameter);

    row++;
  }

  const filename = `vegetacion_${currentDate}.xlsx`;
  await workbook.toFileAsync(`./${filename}`);

  res.status(200).send({ message: 'File created successfully' });
});

app.get('/api/download-file/', (req, res) => {
  let { id, filename } = req.query;

  const filePath = `./secciones_${id}.xlsx`;

  if (!fs.existsSync(filePath)) {
    console.error('Archivo no encontrado');
    res.status(404).send('Archivo no encontrado');
    return;
  }

  const fileStats = fs.statSync(filePath);

  if (fileStats.size > 10 * 1024 * 1024) { // 10 MB limit
    console.error('El archivo es demasiado grande, limite de 10 MB');
    res.status(413).send('El archivo es demasiado grande, limite de 10 MB');
    return;
  }

  xlsxPopulate.fromFileAsync(filePath)
    .then(workbook => {
      return workbook.outputAsync()
    })
    .then(data => {
      res.attachment(`${filename}.xlsx`);
      res.contentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(data);
    })
    .catch(error => {
      console.error('error: ', error)
      res.status(500).send({
        error,
        message: 'Error al descargar el archivo'
      })
    })
});

app.get('/api/download-vegetation-file/', (req, res) => {
  const currentDate = getCurrentDate();

  const filePath = `./vegetacion_${currentDate}.xlsx`;

  if (!fs.existsSync(filePath)) {
    res.status(404).send('Archivo no encontrado');
    return;
  }

  xlsxPopulate.fromFileAsync(filePath)
    .then(workbook => {
      return workbook.outputAsync()
    })
    .then(data => {
      res.attachment(`vegetacion_${currentDate}.xlsx`);
      res.contentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(data);
    })
    .catch(error => {
      console.error('error: ', error)
      res.status(500).send({
        error,
        message: 'Error al descargar el archivo'
      })
    })
});

app.get('/health', (req, res) => {
  res.send('OK')
})

app.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
})