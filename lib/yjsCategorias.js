"use client";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";

const familyDocs = new Map();
const familyPersistences = new Map();



export function getCategoryDoc(familiaId) {
    if (!familiaId) return null;
    return familyDocs.get(familiaId);
}
export function getCategoryRootMap(familiaId) {
    const yDoc = getCategoryDoc(familiaId);
    return yDoc ? yDoc.getMap("root-categories") : null;
}
export function getCategoryMetaMap(familiaId) {
    const yDoc = getCategoryDoc(familiaId);
    return yDoc ? yDoc.getMap("meta") : null;
}


export async function initCategories(familiaId) {
    if (typeof window === 'undefined' || !familiaId) return;

    if (familyDocs.has(familiaId)) {
        return familyPersistences.get(familiaId).whenSynced;
    }

    const yDoc = new Y.Doc();


    const persistence = new IndexeddbPersistence(
        `tcc-categorias-doc-${familiaId}`, // Chave única por família
        yDoc
    );

    familyDocs.set(familiaId, yDoc);
    familyPersistences.set(familiaId, persistence);

    const yCategoriesMeta = yDoc.getMap("meta");
    const yRootMap = yDoc.getMap("root-categories");

    yDoc.on('update', (update, origin) => {
        if (origin !== 'sync' && origin !== 'local-meta') {
            yDoc.transact(() => {
                yCategoriesMeta.set('sincronizado', false);
            }, 'local-meta');
        }
    });

    await persistence.whenSynced;

    if (!yRootMap.has("outros")) {
        console.log(`(Categorias) Criando arrays de categorias para família: ${familiaId}`);
        yDoc.transact(() => {
            yRootMap.set("alimentacao", new Y.Array());
            yRootMap.set("deslocamento", new Y.Array());
            yRootMap.set("estudo", new Y.Array());
            yRootMap.set("outros", new Y.Array());
            yCategoriesMeta.set('sincronizado', false);
        }, 'local-meta');
    }
    return true;
}

async function ensureReady(familiaId) {
    if (!familyDocs.has(familiaId)) {
        await initCategories(familiaId);
    }
    await familyPersistences.get(familiaId).whenSynced;
}


function findGastoLocation(gastoId, familiaId) {
    const yRootMap = getCategoryRootMap(familiaId);
    if (!yRootMap) return { yArray: null, index: -1, item: null, catId: null };

    const categorias = ["alimentacao", "deslocamento", "estudo", "outros"];
    for (const catId of categorias) {
        const yArray = yRootMap.get(catId);
        if (yArray) {
            let index = 0;
            for (const item of yArray) {
                if (item && item.get("gastoId") === gastoId) {
                    return { yArray, index, item, catId };
                }
                index++;
            }
        }
    }
    return { yArray: null, index: -1, item: null, catId: null };
}

function getCategoriaElement(categoriaId, familiaId) {
    const yRootMap = getCategoryRootMap(familiaId);
    if (!yRootMap) return null;

    if (!categoriaId) categoriaId = "outros";
    return yRootMap.get(categoriaId);
}



export async function adicionarGastoACategoria(gasto, categoriaId = "outros", familiaId) {
    await ensureReady(familiaId);

    const { item } = findGastoLocation(gasto.id, familiaId);
    if (item) return;

    const targetArray = getCategoriaElement(categoriaId, familiaId);
    if (targetArray) {
        const novoPonteiro = new Y.Map();
        novoPonteiro.set("gastoId", gasto.id);
        targetArray.push([novoPonteiro]);
    }
}

export async function moverGastoParaCategoria(gastoId, novaCategoriaId, familiaId) {
    await ensureReady(familiaId);

    const { yArray: sourceArray, index, catId: oldCatId, item } = findGastoLocation(gastoId, familiaId);
    const destArray = getCategoriaElement(novaCategoriaId, familiaId);

    if (!sourceArray || index === -1) return;
    if (!destArray) return;
    if (oldCatId === novaCategoriaId) return;

    //console.log(`(Array) Movendo ${gastoId} de ${oldCatId} para ${novaCategoriaId} (Fam: ${familiaId})`);

    const ponteiroClone = new Y.Map();
    ponteiroClone.set("gastoId", item.get("gastoId"));

    const yDoc = getCategoryDoc(familiaId);
    yDoc.transact(() => {
        sourceArray.delete(index, 1);
        destArray.push([ponteiroClone]);
    });
}

export async function removerGastoDeCategoria(gastoId, familiaId) {
    await ensureReady(familiaId);
    const { yArray, index } = findGastoLocation(gastoId, familiaId);
    if (yArray && index !== -1) {
        yArray.delete(index, 1);
    }
}

export function getEstruturaCategorias(familiaId, gastosReais = []) {
    const yRootMap = getCategoryRootMap(familiaId);
    const estrutura = {};
    const idsRemovidos = new Set(gastosReais.filter(g => g.removido).map(g => g.id));
    const categorias = ["alimentacao", "deslocamento", "estudo", "outros"];

    if (!yRootMap) return {};

    categorias.forEach(catId => {
        const yArray = yRootMap.get(catId);
        const nomes = { alimentacao: "Alimentação", deslocamento: "Deslocamento", estudo: "Estudo", outros: "Outros" };

        if (yArray) {
            estrutura[catId] = {
                nome: nomes[catId],
                gastos: yArray.toArray().map(yItem => ({
                    id: yItem.get("gastoId"),
                    categoriaId: catId
                })).filter(g => g.id && !idsRemovidos.has(g.id))
            };
        } else {
            estrutura[catId] = { nome: nomes[catId], gastos: [] };
        }
    });
    return estrutura;
}