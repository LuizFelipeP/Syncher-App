import * as Y from "yjs";
import {
    inicializarYjsParaGasto,
    getYjsStateVector,
    applyYjsUpdate,
    getFullYjsUpdate,
    yDocs,
} from "./yjsClient";
import { getLocalGastoIds, addLocalGastoId } from "./gastoIdStore";

import {
    initCategories,
    getCategoryDoc,
    getCategoryMetaMap
} from "./yjsCategorias";

const CATEGORIES_DOC_ID = "categories-global";

export async function sincronizarComServidor(familiaId) {
    if (!familiaId) {
        console.error("sincronizarComServidor chamado sem familiaId");
        return;
    }

    const protocolo = process.env.NEXT_PUBLIC_API_PROTOCOL;
    const host = process.env.NEXT_PUBLIC_API_HOST;
    const port = process.env.NEXT_PUBLIC_API_PORT;
    const urlPull = `${protocolo}://${host}:${port}/api/sincronizarStateVector`;
    const urlPush = `${protocolo}://${host}:${port}/api/sincronizar`;

    try {
        const localGastoIds = getLocalGastoIds(familiaId);
        const initPromises = localGastoIds.map(id => inicializarYjsParaGasto(id, familiaId));

        initPromises.push(initCategories(familiaId));

        await Promise.all(initPromises);
        console.log("Docs locais (gastos e categorias) carregados.");

        const categoriesDoc = getCategoryDoc(familiaId);
        const yCategoriesMeta = getCategoryMetaMap(familiaId);

        if (!categoriesDoc || !yCategoriesMeta) {
            console.error(`Falha ao obter docs de categoria para família ${familiaId} no sync`);
            return;
        }




        const pushPromises = [];
        for (const [gastoId, yDoc] of yDocs.entries()) {
            const yMap = yDoc.getMap("gasto");
            if (yMap.get("sincronizado") === false && yMap.get("familia_id") === familiaId) {
                console.log(`PUSH Gasto: ${gastoId}`);
                const fullUpdate = getFullYjsUpdate(gastoId);
                if (!fullUpdate) continue;

                pushPromises.push(
                    enviarPush(urlPush, gastoId, familiaId, fullUpdate)
                        .then(ok => { if (ok) yMap.set("sincronizado", true); })
                );
            }
        }

        if (yCategoriesMeta.get("sincronizado") === false) {


            const catUpdate = Y.encodeStateAsUpdate(categoriesDoc);

            pushPromises.push(
                enviarPush(urlPush, CATEGORIES_DOC_ID, familiaId, catUpdate)
                    .then(ok => {
                        if (ok) {
                            categoriesDoc.transact(() => {
                                yCategoriesMeta.set("sincronizado", true);
                            }, 'local-meta');
                        }
                    })
            );
        }

        await Promise.all(pushPromises);

        const stateVectors = {};

        for (const gastoId of yDocs.keys()) {
            const yDoc = yDocs.get(gastoId);
            if (yDoc.getMap("gasto").get("familia_id") === familiaId) {
                const sv = getYjsStateVector(gastoId) || new Uint8Array();
                stateVectors[gastoId] = Buffer.from(sv).toString("base64");
            }
        }


        const catSv = Y.encodeStateVector(categoriesDoc);
        stateVectors[CATEGORIES_DOC_ID] = Buffer.from(catSv).toString("base64");

        const response = await fetch(urlPull, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ familiaId, stateVectors }),
        });

        if (!response.ok) throw new Error(`PULL falhou: ${response.status}`);

        const { updates } = await response.json();

        if (updates && Object.keys(updates).length > 0) {
            console.log("Aplicando updates do servidor...");

            for (const [docId, updateB64] of Object.entries(updates)) {
                if (!updateB64) continue;
                const updateBuf = new Uint8Array(Buffer.from(updateB64, "base64"));

                if (docId === CATEGORIES_DOC_ID) {
                    console.log(`Aplicando update em Categorias (Fam: ${familiaId})`);

                    Y.applyUpdate(categoriesDoc, updateBuf, 'sync');

                    categoriesDoc.transact(() => {
                        yCategoriesMeta.set("sincronizado", true);
                    }, 'local-meta');


                } else {

                    addLocalGastoId(familiaId, docId);
                    await inicializarYjsParaGasto(docId, familiaId);
                    applyYjsUpdate(docId, updateBuf);
                    const yDoc = yDocs.get(docId);
                    if (yDoc) yDoc.getMap("gasto").set("sincronizado", true);
                }
            }
        }

    } catch (error) {
        console.error("Erro geral ao sincronizar:", error);
    }
}


async function enviarPush(url, docId, familiaId, updateInfo) {
    try {
        const updateBase64 = Buffer.from(updateInfo).toString("base64");
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                gastoId: docId,
                familiaId,
                update: updateBase64,
            }),
        });
        return res.ok;
    } catch (e) {
        console.error(`Falha rede push ${docId}`, e);
        return false;
    }
}