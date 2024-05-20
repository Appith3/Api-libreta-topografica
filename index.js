import express from 'express';
import { collection, getDocs, query, orderBy, where, doc, getDoc } from 'firebase/firestore';
import xlsxPopulate from 'xlsx-populate';

import { db } from './firebaseConfig.js';

const app = express();

const port = parseInt(process.env.PORT) || 8085;

app.post('/api/create-sections-file/', async (req, res) => {
  const id = req.query.id;

  if (!id || typeof id !== 'string') {
    res.status(400).send('ID de proyecto no valido');
    return;
  }

  const sections = [];

  const projectsRef = collection(db, 'example_projects');
  const projectDoc = doc(projectsRef, id);
  const projetcSnap = await getDoc(projectDoc);

  if (!projetcSnap.exists) {
    res.status(404).send('Documento no encontrado');
    return;
  }

  const stationingRef = collection(db, `example_projects/${id}/stationing`);
  const stationingQuery = query(stationingRef, where('is_complete', '==', true), orderBy('stationing_name', 'asc'));
  const stationingDocs = await getDocs(stationingQuery);

  for (const stationingDoc of stationingDocs.docs) {
    const stationingID = stationingDoc.id;

    const detailsRef = collection(db, `example_projects/${id}/stationing/${stationingID}/details`);
    const detailsQuery = query(detailsRef, orderBy('distance', 'asc'));
    const detailsDocs = await getDocs(detailsQuery);

    let details = []
    const { central_reading, code, stationing_name } = stationingDoc.data();

    for (const detailsDoc of detailsDocs.docs) {
      details.push(detailsDoc.data())
    }

    sections.push({
      stationing_name: stationing_name,
      code: code,
      central_reading: central_reading,
      details: details,
    });
  }

  if (sections.length === 0) {
    res.status(404).send('No hay datos para exportar')
    return;
  }

  let sectionsDrawFormat = []
  let sectionsPrintFormat = []

  for (const section of sections) {
    let { stationing_name, code, details } = section

    const rows = details.length + 1;
    // DrawFormat
    for (let row = 0; row < rows; row++) {
      if (row === 0 || details[row - 1] === -1) {
        sectionsDrawFormat.push([stationing_name, '']);
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
        sectionsPrintFormat.push([stationing_name, , , 1000, code]);
      } else {
        const { detail_name, distance, slope } = details[row - 1];

        if (distance !== -1 || row === details.length) {
          distance < 0
            ? sectionsPrintFormat.push([, distance, , slope, detail_name])
            : sectionsPrintFormat.push([, , distance, slope, detail_name])
        }
      }
    }
  }

  const workbook = await xlsxPopulate.fromBlankAsync()
  const printFormat = workbook.sheet(0).name('Formato');
  const drawFormat = workbook.addSheet('Secciones');

  printFormat.cell('A1').value(sectionsPrintFormat)
  drawFormat.cell('A1').value(sectionsDrawFormat)

  await workbook.toFileAsync(`./secciones_${id}.xlsx`)
  .then(data => {
    console.log('data: ', data)
  });

  res.status(200).send('Achivo creado')
});

app.get('/api/download-file/', (req, res) => {
  let {id, filename} = req.query;

  xlsxPopulate.fromFileAsync(`secciones_${id}.xlsx`)
    .then(workbook => {
      return workbook.outputAsync()
    })
    .then(data => {
       // Set the output file name.
       res.attachment(`${filename}.xlsx`);

       // Send the workbook.
       res.send(data);
    })
    .catch(error => {
      console.error('error: ', error)
      res.status(500).send({
        message: 'Error al descargar el archivo',
        error: error
      })
    })

});

app.get('/health', (req, res) => {
  res.send('OK')
  console.log('OK')
})

app.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
})