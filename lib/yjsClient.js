"use client";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { addLocalGastoId } from "./gastoIdStore";

import {
    adicionarGastoACategoria,
    removerGastoDeCategoria
} from "./yjsCategorias";

const yDocs = new Map();
const persistences = new Map();
const yDocInitPromises = new Map();

export function inicializarYjsParaGasto(gastoId, familiaId) {
    if (typeof window === "undefined" || !gastoId || !familiaId) return Promise.resolve(false);

    const promiseKey = `${familiaId}-${gastoId}`;
    if (yDocInitPromises.has(promiseKey)) {
        return yDocInitPromises.get(promiseKey);
    }

    const initPromise = (async () => {
        const yDoc = new Y.Doc();
        const persistence = new IndexeddbPersistence(
            `gasto-sync-${familiaId}-${gastoId}`,
            yDoc
        );

        persistence.whenSynced.then(() => {
            const yMap = yDoc.getMap("gasto");
            const descricao = yMap.get("descricao");
            if (descricao && typeof descricao === 'string') {
                console.warn(`MIGRANDO GASTO ANTIGO: ${gastoId} (String -> Y.Text)`);
                const oldText = descricao;
                const newYText = new Y.Text();
                newYText.insert(0, oldText);
                yMap.set("descricao", newYText);
            }
        });

        yDocs.set(gastoId, yDoc);
        persistences.set(gastoId, persistence);

        await persistence.whenSynced;
        return true;
    })();

    yDocInitPromises.set(promiseKey, initPromise);

    return initPromise;
}


export async function addGasto(gasto) {
    const { id: gastoId, familia_id, descricao } = gasto;

    addLocalGastoId(familia_id, gastoId);
    await inicializarYjsParaGasto(gastoId, familia_id);

    const yDoc = yDocs.get(gastoId);
    const yMap = yDoc.getMap("gasto");

    if (!yMap.has("id")) {
        const yDescricao = new Y.Text();
        yDescricao.insert(0, descricao);
        yMap.set("descricao", yDescricao);

        Object.entries(gasto).forEach(([key, value]) => {
            if (key !== "descricao") {
                yMap.set(key, value);
            }
        });
        yMap.set("sincronizado", false);

        await adicionarGastoACategoria(gasto, "outros", familia_id);
    }
}

export async function removeGasto(gastoId) {

    const yDoc = yDocs.get(gastoId);
    if (!yDoc) {
        console.warn(`Tentativa de remover gasto ${gastoId} não carregado`);
        return;
    }
    const yMap = yDoc.getMap("gasto");

    const familiaId = yMap.get("familia_id");
    if (!familiaId) {
        console.error(`Gasto ${gastoId} não tem familia_id!`);
        return;
    }

    yMap.set("removido", true);
    yMap.set("sincronizado", false);

    await removerGastoDeCategoria(gastoId, familiaId);

    console.log(`Gasto ${gastoId} marcado como removido`);
}

export async function editGasto(gastoId, updatedGasto) {
    let familiaId = updatedGasto.familia_id;

    const yDoc = yDocs.get(gastoId);
    if (!yDoc) {
        console.warn(`Tentativa de editar gasto ${gastoId} não carregado`);
        return;
    }
    const yMap = yDoc.getMap("gasto");

    if (!familiaId) {
        familiaId = yMap.get("familia_id");
        if (!familiaId) {
            console.error("editGasto precisa da familia_id");
            return;
        }
    }

    Object.entries(updatedGasto).forEach(([key, value]) => {
        if (key !== "descricao") {
            yMap.set(key, value);
        }
    });

    if (Object.keys(updatedGasto).some(k => k !== "descricao")) {
        yMap.set("sincronizado", false);
    }
}

export function getGastos() {
    const gastos = [];
    yDocs.forEach((yDoc, gastoId) => {
        const yMap = yDoc.getMap("gasto");
        const obj = Object.fromEntries(yMap.entries());
        if (obj.descricao && typeof obj.descricao.toString === 'function') {
            obj.descricao = obj.descricao.toString();
        }
        gastos.push(obj);
    });
    return gastos;
}

export function getYjsStateVector(gastoId) {
    const yDoc = yDocs.get(gastoId);
    return yDoc ? Y.encodeStateVector(yDoc) : null;
}

export function applyYjsUpdate(gastoId, update) {
    const yDoc = yDocs.get(gastoId);
    if (yDoc) {
        Y.applyUpdate(yDoc, new Uint8Array(update), 'sync');
    }
}

export function getFullYjsUpdate(gastoId) {
    const yDoc = yDocs.get(gastoId);
    return yDoc ? Y.encodeStateAsUpdate(yDoc) : null;
}

export {yDocs}