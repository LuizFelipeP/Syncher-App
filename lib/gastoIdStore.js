// lib/gastoIdStore.js
// Gerencia a lista de IDs de gastos conhecidos para uma família no localStorage.

const getKey = (familiaId) => `familia_gasto_ids_${familiaId}`;

export const getLocalGastoIds = (familiaId) => {
    if (typeof window === "undefined" || !familiaId) return [];
    try {
        const key = getKey(familiaId);
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.error("Falha ao ler gastoIds do localStorage", e);
        return [];
    }
};

export const addLocalGastoId = (familiaId, gastoId) => {
    if (typeof window === "undefined" || !familiaId || !gastoId) return;
    try {
        const key = getKey(familiaId);
        const ids = getLocalGastoIds(familiaId);
        if (!ids.includes(gastoId)) {
            ids.push(gastoId);
            localStorage.setItem(key, JSON.stringify(ids));
        }
    } catch (e) {
        console.error("Falha ao salvar gastoId no localStorage", e);
    }
};

export const removeLocalGastoId = (familiaId, gastoId) => {
    if (typeof window === "undefined" || !familiaId || !gastoId) return;
    try {
        const key = getKey(familiaId);
        let ids = getLocalGastoIds(familiaId);
        ids = ids.filter(id => id !== gastoId);
        localStorage.setItem(key, JSON.stringify(ids));
    } catch (e) {
        console.error("Falha ao remover gastoId do localStorage", e);
    }
};