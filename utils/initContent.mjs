import { createClient } from '@prismicio/client';
import fetch from 'node-fetch';
import 'dotenv/config'
import path from 'path';
import fs from 'fs-extra'
import axios from 'axios'
import FormData from 'form-data'
import config from '../slicemachine.config.json' assert { type: 'json' }

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function init() {
  const templateRepository = 'website-factory-template';
  const instanceRepository = process.env.TARGET_REPO || config.repositoryName // target repositoryName;
  const apiKey = process.env.CMSRP_API_KEY;
  const email = process.env.CMSRP_EMAIL;
  const password = process.env.CMSRP_PWD;

  // Fetch a document from your repository (using dangerouslyGetAll here, need to paginate if more than 100 docs)
  const client = createClient(templateRepository, { fetch });
  const docs = await client.dangerouslyGetAll();

  console.log(docs)

  //Extract all images used in docs
  const extractedImages = extractImageUrls(docs);
  console.log(extractedImages)

  //Prepare asset comparison table (includes unsplash support)
  let imageFileNames = []
  const assetComparisonTable = extractedImages.map(extractedImage => {
    const extractedFileName = extractedImage.url.includes("images.unsplash.com") ? path.basename(extractedImage.url.split('?')[0]) + ".webp" : removePrefix(extractedImage.url.split('?')[0])
    // If already an image with that fileName then don't remove GUID
    if (imageFileNames.find(fileName => fileName === extractedFileName)) {
      return { olDid: extractedImage.id, url: extractedImage.url.replace("?auto=format,compress", "").replace("?auto=compress,format", ""), fileName: extractedImage.url.includes("images.unsplash.com") ? path.basename(extractedImage.url.split('?')[0]) + ".webp" : extractedImage.url.split('?')[0], newId: "" }
    }
    imageFileNames.push(extractedFileName)
    return { olDid: extractedImage.id, url: extractedImage.url.replace("?auto=format,compress", "").replace("?auto=compress,format", ""), fileName: extractedImage.url.includes("images.unsplash.com") ? path.basename(extractedImage.url.split('?')[0]) + ".webp" : removePrefix(extractedImage.url.split('?')[0]), newId: "" }
  })
  console.log(assetComparisonTable)

  //Prepare doc comparison table
  const docComparisonTable = docs.map(doc => ({ olDid: doc.id, newId: "" }))

  // Construct the Prismic Write request URLs
  const migrationUrl = `https://migration.prismic.io/documents`;
  const assetUrl = `https://asset-api.prismic.io/assets`;

  // Get an auth token
  const authResponse = await fetch('https://auth.prismic.io/login', {
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
    }),
  });

  const token = await authResponse.text(); //process.env.MIGRATION_API_TOKEN

  // Get assets from media library if necessary
  // const assetsResponse = await (await fetch(assetUrl, {
  //   headers: {
  //     Authorization: `Bearer ${token}`,
  //     'x-api-key': apiKey,
  //     'Content-Type': 'application/json',
  //     'repository': templateRepository,
  //   },
  //   method: 'GET'
  // })).json()

  // const urls = assetsResponse.items.map((asset) => asset.url.split('?')[0])

  //Download assets files from asset comparison table
  const downloadFiles = async () => {
    const assetsDir = path.join(process.cwd(), '/assets');

    // Ensure the /assets directory exists
    await fs.ensureDir(assetsDir);

    // Process each URL
    for (const asset of assetComparisonTable) {
      try {
        const response = await axios({
          method: 'GET',
          url: asset.url,
          responseType: 'stream'
        });

        const filePath = path.join(assetsDir, asset.fileName);

        // Pipe the file to the local filesystem
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        // Return a promise that resolves when the file is finished writing
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });

        console.log(`File downloaded and saved: ${filePath}`);
      } catch (error) {
        console.error(`Error downloading ${url}: ${error.message}`);
      }
    }
  };

  // Upload assets and update asset comparison table with new assetID
  const processFiles = async () => {
    const folderPath = path.join(process.cwd(), '/assets');

    try {
      for (let i = 0; i < assetComparisonTable.length; i++) {
        const filePath = path.join(folderPath, assetComparisonTable[i].fileName);
        const uploadResponse = await uploadFile(filePath);
        assetComparisonTable[i].newId = uploadResponse.data.id
      }
    } catch (err) {
      console.error('Error processing files:', err);
    }
  };

  // Upload Asset File query (wait for 2s)
  const uploadFile = async (filePath) => {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));

    const response = await axios.post(assetUrl, formData, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-api-key': apiKey,
        'Content-Type': 'multipart/form-data',
        'repository': instanceRepository,
        'Accept': "application/json"
      },
    });

    await delay(2000);
    return response
  };

  //Replace old AssetId with new AssetId in image field
  function editIdFromImage(obj) {
    for (const key in obj) {
      const item = obj[key];
      if (item && item.alt !== undefined) {
        obj[key].id = assetComparisonTable.find(asset => asset.olDid === item.id).newId
        delete obj[key].url
      }
      if (isFilledRichText(item)) {
        for (let i = 0; i < item.length; i++) {
          const richtextItem = item[i];
          if (richtextItem.type === 'image' && richtextItem.url !== undefined && richtextItem.id !== undefined) {
            obj[key][i].id = assetComparisonTable.find(asset => asset.olDid === richtextItem.id).newId
          }
        }
      }
    }
    return obj
  }

  //Replace assetIDs in all docs
  const mutateDocs = () => {

    docs.forEach(document => {
      if (document && document.data) {
        // Extract from direct data properties
        document.data = editIdFromImage(document.data);

        // Extract from slices if available
        if (document.data.slices) {
          for (let i = 0; i < document.data.slices.length; i++) {
            // Extract from primary object
            if (document.data.slices[i].primary) {
              document.data.slices[i].primary = editIdFromImage(document.data.slices[i].primary);
            }
            // Extract from each item in items array
            if (document.data.slices[i].items && document.data.slices[i].items.length > 0) {
              for (let j = 0; j < document.data.slices[i].items.length; j++) {
                document.data.slices[i].items[j] = editIdFromImage(document.data.slices[i].items[j]);
              }
            }
          }
        }
        //add a title to doc
        document.title = document.uid ? document.type + " " + document.uid : document.type
        //add migration release
        document.releaseId = "migration"
      }
    });
  }

  // Push updated docs to target repository
  const pushUpdatedDocs = async () => {
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i]
      console.log(doc)
      // Send the update
      const response = await fetch(migrationUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          'repository': instanceRepository,
        },
        method: 'POST',
        body: JSON.stringify(doc),
      });

      await delay(2000);
      const newDoc = await response.json();
      console.log(newDoc)
      docComparisonTable[i].newId = newDoc.id
    }
  }

  //Replace old linkId with new linkId in link field
  function editIdFromLink(obj) {
    for (const key in obj) {
      const item = obj[key];
      if (item && item.id && item.isBroken !== undefined) {
        obj[key].id = docComparisonTable.find(doc => doc.olDid === item.id).newId
      }
      if (isFilledRichText(item)) {
        for (let i = 0; i < item.length; i++) {
          const richtextItem = item[i];
          if (richtextItem.spans !== undefined && richtextItem.spans.length > 0) {
            for (let j = 0; j < richtextItem.spans.length; j++) {
              if (richtextItem.spans[j] !== undefined && richtextItem.spans[j].type === "hyperlink" && richtextItem.spans[j].data !== undefined && richtextItem.spans[j].data.id !== undefined) {
                console.log(richtextItem.spans[j].data.id)
                obj[key][i].spans[j].data.id = docComparisonTable.find(doc => doc.olDid === richtextItem.spans[j].data.id).newId
              }
            }
          }
        }
      }
    }
    return obj
  }

  //Replace assetIDs in all docs (need to add support for RichText links)
  const mutateDocsWithLinks = () => {

    docs.forEach(document => {
      if (document && document.data) {
        // Set New id
        // richtext example https://github.com/prismicio-solution-engineering/sm-migration-scripts/blob/master/migrate-links.mjs
        document.id = docComparisonTable.find(doc => doc.olDid === document.id).newId

        // Extract from direct data properties
        document.data = editIdFromLink(document.data);

        // Extract from slices if available
        if (document.data.slices) {
          for (let i = 0; i < document.data.slices.length; i++) {
            // Extract from primary object
            if (document.data.slices[i].primary) {
              document.data.slices[i].primary = editIdFromLink(document.data.slices[i].primary);
            }
            // Extract from each item in items array
            if (document.data.slices[i].items && document.data.slices[i].items.length > 0) {
              for (let j = 0; j < document.data.slices[i].items.length; j++) {
                document.data.slices[i].items[j] = editIdFromLink(document.data.slices[i].items[j]);
              }
            }
          }
        }
        //add a title to doc
        document.title = document.uid ? document.type + " " + document.uid : document.type
        //add migration release
        document.releaseId = "migration"
      }
    });
  }

  // Push updated docs to target repository
  const pushUpdatedDocsWithLinks = async () => {
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i]
      // Send the update
      const response = await fetch(migrationUrl + "/" + doc.id, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          'repository': instanceRepository,
        },
        method: 'PUT',
        body: JSON.stringify(doc),
      });

      await delay(2000);
    }
  }

  try {
    //Main execution stack
    await downloadFiles();
    console.log('All files have been downloaded');
    await processFiles();
    await deleteDirectory();
    console.log(assetComparisonTable)
    mutateDocs()
    console.log(docs)
    await pushUpdatedDocs()
    console.log(docComparisonTable)
    mutateDocsWithLinks()
    console.log(docs)
    await pushUpdatedDocsWithLinks()
  } catch (err) {
    console.error('An error occurred:', err);
  }

}

// Get all assets from a list of docs
function extractImageUrls(documents) {
  const imageUrls = [];

  documents.forEach((document) => {
    if (document && document.data) {
      // Extract from direct data properties
      extractFromObject(document.data, imageUrls);

      // Extract from slices if available
      if (document.data.slices) {
        document.data.slices.forEach(slice => {
          // Extract from primary object
          if (slice.primary) {
            extractFromObject(slice.primary, imageUrls);
          }

          // Extract from each item in items array
          if (slice.items && slice.items.length > 0) {
            slice.items.forEach(item => {
              extractFromObject(item, imageUrls);
            });
          }
        });
      }
    };
  })
  return imageUrls;
}

// Empty /assets repository
const deleteDirectory = async () => {
  const folderPath = path.join(process.cwd(), '/assets');
  try {
    await fs.promises.rm(folderPath, { recursive: true, force: true });
    console.log('Directory and its contents have been deleted');
  } catch (err) {
    console.error('Error deleting directory:', err);
  }
};

// Get Images Fields children from a parent 
function extractFromObject(obj, imageUrls) {
  for (const key in obj) {
    const item = obj[key];
    if (item && item.alt !== undefined) {
      if (!imageUrls.find(image => image.id === item.id)) {
        imageUrls.push({ id: item.id, url: item.url });
      }
    }
    if (isFilledRichText(item)) {
      for (let i = 0; i < item.length; i++) {
        const richtextItem = item[i];
        if (richtextItem.type === 'image' && richtextItem.url !== undefined && richtextItem.id !== undefined) {
          if (!imageUrls.find(image => image.id === richtextItem.id)) {
            imageUrls.push({ id: richtextItem.id, url: richtextItem.url });
          }
        }
      }
    }
  }
}

// Remove GUID to get asset fileName
function removePrefix(fileName, assetComparisonTable) {
  // Split the string into an array using '_' as the separator
  const parts = fileName.split('_');
  // Slice the array from the second element onwards and join it back into a string
  return parts.slice(1).join('_');
}

//Check if field is a Rich Text
function isFilledRichText(field) {
  if (
    Array.isArray(field) &&
    field.length > 0 &&
    (
      field[0].type === "paragraph" ||
      field[0].type === "heading1" ||
      field[0].type === "heading2" ||
      field[0].type === "heading3" ||
      field[0].type === "heading4" ||
      field[0].type === "heading5" ||
      field[0].type === "heading6" ||
      field[0].type === "list-item" ||
      field[0].type === "o-list-item" ||
      field[0].type === "embed" ||
      field[0].type === "preformatted" ||
      field[0].type === "image"
    )
  ) {
    return true;
  }
  return false;
}

init();

