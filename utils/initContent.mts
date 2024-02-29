import fetch from 'node-fetch';
import 'dotenv/config'
import path from 'path';
import fs from 'fs-extra'
import axios from 'axios'
import FormData from 'form-data'
//import config from '../slicemachine.config.json' assert { type: 'json' }
import { AllDocumentTypes } from '../prismicio-types.js';
import { createClient, AnyRegularField, GroupField, SliceZone, isFilled, RTNode, FilledLinkToMediaField, PrismicDocument } from '@prismicio/client';

const templateRepository = 'website-factory-template';
const instanceRepository = process.env.TARGET_REPO ? process.env.TARGET_REPO : "website-factory-instance-alpha" //|| config.repositoryName // target repositoryName;
const apiKey = process.env.CMSRP_API_KEY;
const email = process.env.CMSRP_EMAIL;
const password = process.env.CMSRP_PWD;
// Construct the Prismic Write request URLs
const migrationUrl = `https://migration.prismic.io/documents`;
const assetUrl = `https://asset-api.prismic.io/assets`;

async function init() {

    try {
        //Main execution stack

        // Fetch a document from your repository (using dangerouslyGetAll here, need to paginate if more than 100 docs)
        const client = createClient(templateRepository, { fetch });
        const docs = await client.dangerouslyGetAll();
        console.log(docs)

        // Extract image urls from docs and build assetComparison table
        const assetComparisonTable = extractImageUrls(docs);
        console.log(assetComparisonTable)

        // Download images from template repo
        await downloadFiles(assetComparisonTable);
        console.log('All files have been downloaded');

        // Get Auth token
        const token = await getAuthToken()

        // Upload images to new instance and update assetComparison table
        await processFiles(assetComparisonTable, token);
        console.log(assetComparisonTable)

        // Delete local images
        await deleteDirectory();

        // Insert new Asset Ids in docs
        const docsWithNewAssetIds = mutateDocs(docs, assetComparisonTable)
        console.log(docsWithNewAssetIds)

        // Push docs with new Asset Ids and build docComparisonTable
        const docComparisonTable = await pushUpdatedDocs(docsWithNewAssetIds, token)
        console.log(docComparisonTable)

        // // Insert new Links Ids in docs
        const docsWithNewLinks = mutateDocsWithLinks(docsWithNewAssetIds, docComparisonTable)
        console.log(docsWithNewLinks)

        // Push docs with new Link Ids
        await pushUpdatedDocsWithLinks(docsWithNewLinks,token)
    } catch (err) {
        console.error('An error occurred:', err);
    }

}

init();

// Get all assets from a list of docs
function extractImageUrls(documents: AllDocumentTypes[]) {
    const imageUrls: {
        id: string;
        url: string;
    }[] = [];

    const imageFileNames: string[] = []

    documents.forEach((document) => {
        if (document && document.data) {
            // Extract from direct data properties
            extractImageFromObject(document.data, imageUrls);

            // Extract from slices if available
            if ("slices" in document.data && document.data.slices) {
                document.data.slices.forEach((slice) => {
                    // Extract from primary object
                    if (slice.primary) {
                        extractImageFromObject(slice.primary, imageUrls);
                    }

                    // Extract from each item in items array
                    if (slice.items && slice.items.length > 0) {
                        slice.items.forEach(item => {
                            extractImageFromObject(item, imageUrls);
                        });
                    }
                });
            }
        };
    })

    const assetComparisonTable = imageUrls.map(extractedImage => {
        const extractedFileName: string = extractedImage.url.includes("images.unsplash.com") ? path.basename(extractedImage.url.split('?')[0]) + ".webp" : removePrefix(extractedImage.url.split('?')[0])
        // If already an image with that fileName then don't remove GUID
        if (imageFileNames.find(fileName => fileName === extractedFileName)) {
            return { olDid: extractedImage.id, url: extractedImage.url.replace("?auto=format,compress", "").replace("?auto=compress,format", ""), fileName: extractedImage.url.includes("images.unsplash.com") ? path.basename(extractedImage.url.split('?')[0]) + ".webp" : extractedImage.url.split('?')[0], newId: "" }
        }
        imageFileNames.push(extractedFileName)
        return { olDid: extractedImage.id, url: extractedImage.url.replace("?auto=format,compress", "").replace("?auto=compress,format", ""), fileName: extractedImage.url.includes("images.unsplash.com") ? path.basename(extractedImage.url.split('?')[0]) + ".webp" : removePrefix(extractedImage.url.split('?')[0]), newId: "" }
    })

    return assetComparisonTable;
}

// Remove GUID to get asset fileName
function removePrefix(fileName: string) {
    // Split the string into an array using '_' as the separator
    const parts = fileName.split('_');
    // Slice the array from the second element onwards and join it back into a string
    return parts.slice(1).join('_');
}

// Get Images Fields children from a parent 
function extractImageFromObject(record: Record<string, AnyRegularField | GroupField | SliceZone>, imageUrls: { id: string; url: string; }[]) {
    for (const fieldName in record) {
        const field = record[fieldName];
        //Check if field is an Image 
        if (field && typeof field === "object" && "alt" in field && !("embed_url" in field) && isFilled.image(field)) {
            //console.log("root field", field)
            if (!imageUrls.find(image => image.id === field.id)) {
                imageUrls.push({ id: field.id, url: field.url });
            }
        }
        //Check if field is a link to Media 
        if (field && typeof field === "object" && "link_type" in field && field.link_type === "Media") {
            const mediaField = field as FilledLinkToMediaField
            if (mediaField.id !== undefined) {
                //console.log("root linkmedia field", field)
                if (!imageUrls.find(image => image.id === mediaField.id)) {
                    imageUrls.push({ id: mediaField.id, url: mediaField.url });
                }
            }
        }
        //Check if field a RichText or a Group containing an image
        if (field && Array.isArray(field)) {
            for (let i = 0; i < field.length; i++) {
                const fieldItem = field[i];
                // Check if field is a RichText containing an image
                if ("type" in fieldItem && fieldItem.type === 'image' && fieldItem.url !== undefined && fieldItem.id !== undefined) {
                    //console.log("in a richtext", fieldItem)
                    if (!imageUrls.find(image => image.id === fieldItem.id)) {
                        imageUrls.push({ id: fieldItem.id, url: fieldItem.url });
                    }
                }
                // Check if field is a Group containing an image
                if (!("slice_type" in fieldItem) && !("type" in fieldItem)) {
                    for (const subFieldName in fieldItem) {
                        const subField = fieldItem[subFieldName]
                        // Check if field is a Group containing directly an image
                        if (subField && typeof subField === "object" && !("type" in subField) && "alt" in subField && !("embed_url" in subField) && isFilled.image(subField)) {
                            //console.log("in a group", subField)
                            if (!imageUrls.find(image => image.id === subField.id)) {
                                imageUrls.push({ id: subField.id, url: subField.url });
                            }
                        }
                        //Check if field is a Group containing link to Media 
                        if (subField && typeof subField === "object" && "link_type" in subField && subField.link_type === "Media") {
                            const mediaSubField = subField as FilledLinkToMediaField
                            if (mediaSubField.id !== undefined) {
                                //console.log("in a group linkmedia field", subField)
                                if (!imageUrls.find(image => image.id === mediaSubField.id)) {
                                    imageUrls.push({ id: mediaSubField.id, url: mediaSubField.url });
                                }
                            }
                        }
                        // Check if field is a Group containing a RichText containing an image
                        if (Array.isArray(subField)) {
                            for (let j = 0; j < subField.length; j++) {
                                const richTextItem = subField[j] as RTNode;
                                // Check if field is a RichText containing an image
                                if ("type" in richTextItem && richTextItem.type === 'image' && richTextItem.url !== undefined && richTextItem.id !== undefined) {
                                    //console.log("in a richtext in a group", richTextItem)
                                    if (!imageUrls.find(image => image.id === richTextItem.id)) {
                                        imageUrls.push({ id: richTextItem.id, url: richTextItem.url });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// // Download images from template repo
const downloadFiles = async (assetComparisonTable: {
    olDid: string;
    url: string;
    fileName: string;
    newId: string;
}[]) => {
    const assetsDir = path.join(process.cwd(), '/assets');

    // Ensure the /assets directory exists
    await fs.ensureDir(assetsDir);

    console.log(assetComparisonTable)
    // Process each URL
    for (const asset of assetComparisonTable) {
        console.log(asset)
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
            if (error instanceof Error) {
                console.error(`Error downloading ${asset.url}: ${error.message}`);
            }
        }
    }
};

// Upload assets and update asset comparison table with new assetID
const processFiles = async (assetComparisonTable: {
    olDid: string;
    url: string;
    fileName: string;
    newId: string;
}[], token: string) => {
    const folderPath = path.join(process.cwd(), '/assets');

    try {
        for (let i = 0; i < assetComparisonTable.length; i++) {
            const filePath = path.join(folderPath, assetComparisonTable[i].fileName);
            const uploadResponse = await uploadFile(filePath, token);
            assetComparisonTable[i].newId = uploadResponse.data.id
        }
        console.log('All assets uploaded to target media library');
    } catch (err) {
        console.error('Error processing files:', err);
    }
};

// Upload Asset File query (wait for 2s)
const uploadFile = async (filePath: fs.PathLike, token: string) => {
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

// Get an auth token
const getAuthToken = async () => {
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

    return token
}

const delay = (ms: number | undefined) => new Promise(resolve => setTimeout(resolve, ms));

// Empty /assets repository
const deleteDirectory = async () => {
    const folderPath = path.join(process.cwd(), '/assets');
    try {
        await fs.promises.rm(folderPath, { recursive: true, force: true });
        console.log('Assets directory and its contents have been deleted');
    } catch (err) {
        console.error('Error deleting directory:', err);
    }
};

//Replace assetIDs in all docs
const mutateDocs = (docs: AllDocumentTypes[], assetComparisonTable: {
    olDid: string;
    url: string;
    fileName: string;
    newId: string;
}[]) => {

    const mutatedDocs: (PrismicDocument & { title: string })[] = []

    docs.forEach(document => {
        const mutatedDoc: PrismicDocument & { title: string } = { ...document, title: "Title" }
        if (document && document.data) {
            // Extract from direct data properties
            mutatedDoc.data = editIdFromImage(document.data, assetComparisonTable);

            // Extract from slices if available
            if ("slices" in document.data && document.data.slices) {
                for (let i = 0; i < document.data.slices.length; i++) {
                    // Extract from primary object
                    if (document.data.slices[i].primary) {
                        mutatedDoc.data.slices[i].primary = editIdFromImage(document.data.slices[i].primary, assetComparisonTable);
                    }
                    // Extract from each item in items array
                    if (document.data.slices[i].items && document.data.slices[i].items.length > 0) {
                        for (let j = 0; j < document.data.slices[i].items.length; j++) {
                            mutatedDoc.data.slices[i].items[j] = editIdFromImage(document.data.slices[i].items[j], assetComparisonTable);
                        }
                    }
                }
            }
            //add a title to doc
            mutatedDoc.title = document.uid ? document.type + " " + document.uid : document.type
        }
        mutatedDocs.push(mutatedDoc)
    });
    return mutatedDocs
}

//Replace old AssetId with new AssetId in image field
function editIdFromImage(record: Record<string, AnyRegularField | GroupField | SliceZone>, assetComparisonTable: {
    olDid: string;
    url: string;
    fileName: string;
    newId: string;
}[]) {
    for (const fieldName in record) {
        const field = record[fieldName];
        //Check if field is an Image 
        if (field && typeof field === "object" && "alt" in field && !("embed_url" in field) && isFilled.image(field)) {
            field.id = assetComparisonTable.find(asset => asset.olDid === field.id)!.newId
            field.url = ""
            record[fieldName] = field
        }
        //Check if field is a link to Media 
        if (field && typeof field === "object" && "link_type" in field && field.link_type === "Media") {
            const mediaField = field as FilledLinkToMediaField
            if (mediaField.id !== undefined) {
                mediaField.id = assetComparisonTable.find(asset => asset.olDid === mediaField.id)!.newId
                mediaField.url = ""
                record[fieldName] = field
            }
        }
        //Check if field a RichText or a Group containing an image
        if (field && Array.isArray(field)) {
            for (let i = 0; i < field.length; i++) {
                const fieldItem = field[i];
                // Check if field is a RichText containing an image
                if ("type" in fieldItem && fieldItem.type === 'image' && fieldItem.url !== undefined && fieldItem.id !== undefined) {
                    fieldItem.id = assetComparisonTable.find(asset => asset.olDid === fieldItem.id)!.newId
                }
                // Check if field is a Group containing an image
                if (!("slice_type" in fieldItem) && !("type" in fieldItem)) {
                    for (const subFieldName in fieldItem) {
                        const subField = fieldItem[subFieldName]
                        // Check if field is a Group containing directly an image
                        if (subField && typeof subField === "object" && !("type" in subField) && "alt" in subField && !("embed_url" in subField) && isFilled.image(subField)) {
                            subField.id = assetComparisonTable.find(asset => asset.olDid === subField.id)!.newId
                            subField.url = ""
                            fieldItem[subFieldName] = subField
                        }
                        //Check if field is a Group containing link to Media 
                        if (subField && typeof subField === "object" && "link_type" in subField && subField.link_type === "Media") {
                            const mediaSubField = subField as FilledLinkToMediaField
                            if (mediaSubField.id !== undefined) {
                                mediaSubField.id = assetComparisonTable.find(asset => asset.olDid === mediaSubField.id)!.newId
                                mediaSubField.url = ""
                                fieldItem[subFieldName] = mediaSubField
                            }
                        }
                        // Check if field is a Group containing a RichText containing an image
                        if (Array.isArray(subField)) {
                            for (let j = 0; j < subField.length; j++) {
                                const richTextItem = subField[j] as RTNode;
                                // Check if field is a RichText containing an image
                                if ("type" in richTextItem && richTextItem.type === 'image' && richTextItem.url !== undefined && richTextItem.id !== undefined) {
                                    richTextItem.id = assetComparisonTable.find(asset => asset.olDid === richTextItem.id)!.newId
                                    subField[j] = richTextItem
                                }
                            }
                            fieldItem[subFieldName] = subField
                        }
                    }
                }
                // store changes
                field[i] = fieldItem
            }
            //store changes
            record[fieldName] = field
        }
    }
    return record
}

// Push updated docs to target repository
const pushUpdatedDocs = async (docsWithNewAssetIds: (PrismicDocument & { title: string })[], token: string) => {

    const docComparisonTable = docsWithNewAssetIds.map(doc => ({ olDid: doc.id, newId: "" }))

    for (let i = 0; i < docsWithNewAssetIds.length; i++) {
        const doc = docsWithNewAssetIds[i]

        // Send the update
        try {
            const response = await fetch(migrationUrl, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-api-key': apiKey!,
                    'Content-Type': 'application/json',
                    'repository': instanceRepository!,
                },
                method: 'POST',
                body: JSON.stringify(doc),
            });
            if (response.ok) {
                console.log('New document imported of type : ' + doc.type + " and uid: " + doc.uid);
                const newDoc = await response.json() as {
                    id: string,
                    type: string,
                    lang: string,
                    title: string
                };
                docComparisonTable[i].newId = newDoc.id
            } else {
                console.error('Request failed for doc of type : ' + doc.type + " and uid: " + doc.uid + " Error details : " + await response.text());
            }
            await delay(2000);
        } catch (err) {
            console.error('Error while uploading new document: ', err);
        }
    }
    return docComparisonTable
}

//Replace assetIDs in all docs (need to add support for RichText links)
const mutateDocsWithLinks = (docs: (PrismicDocument & { title: string })[], docComparisonTable: {
    olDid: string;
    newId: string;
}[]) => {

    const mutatedDocs: (PrismicDocument & { title: string })[] = []

    docs.forEach(document => {
        const mutatedDoc: PrismicDocument & { title: string } = { ...document }
        if (document && document.data) {
            // Set New id
            // richtext example https://github.com/prismicio-solution-engineering/sm-migration-scripts/blob/master/migrate-links.mjs
            mutatedDoc.id = docComparisonTable.find(doc => doc.olDid === document.id)!.newId

            // Extract from direct data properties
            mutatedDoc.data = editIdFromLink(document.data, docComparisonTable);

            // Extract from slices if available
            if (document.data.slices) {
                for (let i = 0; i < document.data.slices.length; i++) {
                    // Extract from primary object
                    if (document.data.slices[i].primary) {
                        mutatedDoc.data.slices[i].primary = editIdFromLink(document.data.slices[i].primary, docComparisonTable);
                    }
                    // Extract from each item in items array
                    if (document.data.slices[i].items && document.data.slices[i].items.length > 0) {
                        for (let j = 0; j < document.data.slices[i].items.length; j++) {
                            mutatedDoc.data.slices[i].items[j] = editIdFromLink(document.data.slices[i].items[j], docComparisonTable);
                        }
                    }
                }
            }
        }
        mutatedDocs.push(mutatedDoc)
    });
    return mutatedDocs
}

//Replace old linkId with new linkId in link field
function editIdFromLink(record: Record<string, AnyRegularField | GroupField | SliceZone>, docComparisonTable: {
    olDid: string;
    newId: string;
}[]) {
    for (const fieldName in record) {
        const field = record[fieldName];
        //Check if field is a Link 
        if (field && typeof field === "object" && "id" in field && "isBroken" in field && field.isBroken === false) {
            field.id = docComparisonTable.find(doc => doc.olDid === field.id)!.newId
            record[fieldName] = field
        }
        //Check if field a RichText or a Group containing a Link
        if (field && Array.isArray(field)) {
            for (let i = 0; i < field.length; i++) {
                const fieldItem = field[i];
                // Check if field is a RichText containing a link
                if ("type" in fieldItem && "spans" in fieldItem && Array.isArray(fieldItem.spans) && fieldItem.spans.length > 0) {
                    for (let j = 0; j < fieldItem.spans.length; j++) {
                        const fieldItemSpan = fieldItem["spans"][j]
                        if (fieldItemSpan.type === "hyperlink" && "data" in fieldItemSpan && fieldItemSpan.data.link_type === "Document") {
                            const fieldItemSpanlinkId = fieldItemSpan.data.id
                            fieldItemSpan.data.id = docComparisonTable.find(doc => doc.olDid === fieldItemSpanlinkId)!.newId
                        }
                        fieldItem["spans"][j] = fieldItemSpan
                    }
                }
                // Check if field is a Group containing an image
                if (!("slice_type" in fieldItem) && !("type" in fieldItem)) {
                    for (const subFieldName in fieldItem) {
                        const subField = fieldItem[subFieldName]
                        // Check if field is a Group containing directly a link
                        if (subField && typeof subField === "object" && "id" in subField && "isBroken" in subField && subField.isBroken === false) {
                            subField.id = docComparisonTable.find(doc => doc.olDid === subField.id)!.newId
                            fieldItem[subFieldName] = subField
                        }
                        // Check if field is a Group containing a RichText containing a link
                        if (Array.isArray(subField)) {
                            for (let j = 0; j < subField.length; j++) {
                                const richTextItem = subField[j] as RTNode;
                                // Check if field is a RichText containing a link
                                if ("type" in richTextItem && "spans" in richTextItem && Array.isArray(richTextItem.spans) && richTextItem.spans.length > 0) {
                                    for (let k = 0; k < richTextItem.spans.length; k++) {
                                        const fieldItemSpan = richTextItem["spans"][k]
                                        if (fieldItemSpan.type === "hyperlink" && "data" in fieldItemSpan && fieldItemSpan.data.link_type === "Document") {
                                            const fieldItemSpanlinkId = fieldItemSpan.data.id
                                            fieldItemSpan.data.id = docComparisonTable.find(doc => doc.olDid === fieldItemSpanlinkId)!.newId
                                        }
                                        richTextItem["spans"][k] = fieldItemSpan
                                    }
                                }
                                subField[j] = richTextItem
                            }
                            fieldItem[subFieldName] = subField
                        }
                    }
                }
                // store changes
                field[i] = fieldItem
            }
            //store changes
            record[fieldName] = field
        }
    }
    return record
}

// Push updated docs to target repository
const pushUpdatedDocsWithLinks = async (docsWithNewLinks: (PrismicDocument & { title: string })[],token:string) => {
    for (let i = 0; i < docsWithNewLinks.length; i++) {
        const doc = docsWithNewLinks[i]
        // Send the update
        const response = await fetch(migrationUrl + "/" + doc.id, {
            headers: {
                Authorization: `Bearer ${token}`,
                'x-api-key': apiKey!,
                'Content-Type': 'application/json',
                'repository': instanceRepository!,
            },
            method: 'PUT',
            body: JSON.stringify(doc),
        });

        await delay(2000);
    }
}