"use client";
import * as Y from "yjs";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
    addGasto,
    removeGasto,
    editGasto,
    getGastos,
    yDocs
} from "@/lib/yjsClient";
import { sincronizarComServidor } from "@/lib/sync";
import { TextAreaBinding  } from "y-textarea";

import {
    initCategories,
    moverGastoParaCategoria,
    getEstruturaCategorias,
    getCategoryRootMap
} from "@/lib/yjsCategorias";

import styles from './dashboard.module.css';


function BoundTextarea({ gastoId }) {
    const textareaRef = useRef(null);
    useEffect(() => {
        if (!textareaRef.current || !gastoId) return;
        const yDoc = yDocs.get(gastoId);
        if (!yDoc) return;
        const yMap = yDoc.getMap("gasto");
        const yDescricao = yMap.get("descricao");
        if (!yDescricao || !(yDescricao instanceof Y.Text)) {
            console.error("Erro: 'descricao' não é um Y.Text!");
            return;
        }
        const binding = new TextAreaBinding(yDescricao, textareaRef.current);
        const observer = () => {
            yMap.set("sincronizado", false);
        };
        yDescricao.observe(observer);
        return () => {
            yDescricao.unobserve(observer);
            binding.destroy();
        };
    }, [gastoId]);
    return (
        <textarea
            ref={textareaRef}
            className={styles.input}
            placeholder="Editando descrição ao vivo..."
        />
    );
}


export default function Dashboard() {
    const router = useRouter();

    const [usuario, setUsuario] = useState(null);
    const usuarioRef = useRef(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isOnline, setIsOnline] = useState(true);
    const [editandoId, setEditandoId] = useState(null);
    const [valorEdit, setValorEdit] = useState("");
    const [estruturaCategorias, setEstruturaCategorias] = useState({});
    const refreshUI = useCallback(() => {
        const user = usuarioRef.current;
        if (!user) return;

        const gastosReais = getGastos();
        const gastosMap = new Map(gastosReais.map(g => [g.id, g]));

        const estruturaEsqueleto = getEstruturaCategorias(user.familia_id, gastosReais);

        const estruturaHidratada = {};
        for (const [catId, categoria] of Object.entries(estruturaEsqueleto)) {
            estruturaHidratada[catId] = {
                ...categoria,
                gastos: categoria.gastos.map(ponteiro => {
                    const gastoReal = gastosMap.get(ponteiro.id);
                    if (!gastoReal) {
                        return { ...ponteiro, nome: "Carregando..." };
                    }
                    return { ...gastoReal, ...ponteiro };
                })
            };
        }
        setEstruturaCategorias(estruturaHidratada);
    }, []);


    const runSync = useCallback(async () => {
        //console.log("Sincronizando...");
        const user = usuarioRef.current;
        if (!user) return;

        try {
            await sincronizarComServidor(user.familia_id);
            refreshUI();
        } catch (err) {
            console.error(err);
            refreshUI();
        }
    }, [refreshUI]);

    useEffect(() => {
        const initializeApp = async () => {
            setIsLoading(true);
            try {
                const user = await getUserData();
                if (!user || !user.familia_id) {
                    router.push("/");
                    return;
                }

                setUsuario(user);
                usuarioRef.current = user;

                await initCategories(user.familia_id);
                //console.log("Categorias da família prontas.");

                await sincronizarComServidor(user.familia_id);
                //console.log("Sincronização inicial concluída.");

                refreshUI();

            } catch (err) {
                console.error("Falha na inicialização:", err);
            } finally {
                setIsLoading(false);
            }
        };

        initializeApp();

    }, [router]);


    useEffect(() => {

        const user = usuarioRef.current;
        if (!user) return;

        const docObserver = () => {
            //console.log("Mudança detectada, atualizando UI...");
            refreshUI();
        };

        const familyRootMap = getCategoryRootMap(user.familia_id);

        if (familyRootMap) {
            familyRootMap.observeDeep(docObserver);
        }

        yDocs.forEach(doc => {
            if (doc.getMap("gasto").get("familia_id") === user.familia_id) {
                doc.on('update', docObserver);
            }
        });

        return () => {
            if (familyRootMap) {
                familyRootMap.unobserveDeep(docObserver);
            }
            yDocs.forEach(doc => doc.off('update', docObserver));
        };
    }, [refreshUI, usuario]);


    useEffect(() => {
        if (typeof window === "undefined") return;
        setIsOnline(navigator.onLine);
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);
        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);
        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
        };
    }, []);

    const handleRemoveGasto = async (gastoId) => {
        await removeGasto(gastoId);
        refreshUI();
    };

    const handleEditGasto = async (gastoId, updated) => {
        const user = usuarioRef.current;
        if (!user) return;

        const gastoComFamilia = { ...updated, familia_id: user.familia_id };
        await editGasto(gastoId, gastoComFamilia);
        setEditandoId(null);
    };

    const handleMoveCategoria = async (gastoId, novaCategoriaId) => {
        const user = usuarioRef.current;
        if (!user) return;

        await moverGastoParaCategoria(gastoId, novaCategoriaId, user.familia_id);
    };

    const handleSync = async () => {
        const user = usuarioRef.current;
        if (!user || !isOnline) return;

        setIsLoading(true);
        await runSync();
        setIsLoading(false);
    };


    if (isLoading) return <p>Carregando...</p>;
    if (!usuario) return <p>Erro ao carregar usuário.</p>;

    return (
        <main className={styles.main}>
            <div className={styles.container}>
                <h2 className={styles.title}>Bem-vindo, {usuario.nome}</h2>
                <div className={styles.buttonsRow}>
                    <button className={styles.button} onClick={() => router.push("/edit-user")} disabled={!isOnline || isLoading}>
                        Editar Informações
                    </button>
                    <button className={styles.button} onClick={handleSync} disabled={!isOnline || isLoading}>
                        {isLoading ? "Sincronizando..." : "Sincronizar"}
                    </button>
                </div>

                <section className={styles.section}>
                    <h3 className={styles.subtitle}>Gastos Registrados</h3>
                    <button className={styles.button} onClick={() => router.push("/add-gasto")}>
                        Adicionar Gasto
                    </button>

                    <div className={styles.categoryContainer}>
                        {Object.entries(estruturaCategorias).map(([catId, categoria]) => (
                            <div key={catId} className={styles.categoryGroup}>
                                <h4 className={styles.categoryTitle}>{categoria.nome}</h4>
                                <ul className={styles.gastosList}>
                                    {categoria.gastos.length === 0 && <small>Vazio</small>}

                                    {categoria.gastos.map(gasto => (
                                        <li key={gasto.id} className={styles.gastoItem}>
                                            {editandoId === gasto.id ? (
                                                <>
                                                    <label>Descrição:</label>
                                                    <BoundTextarea gastoId={gasto.id} />
                                                    <label>Valor:</label>
                                                    <input className={styles.input} type="number" value={valorEdit} onChange={e => setValorEdit(e.target.value)} />

                                                    <label>Categoria:</label>
                                                    <select className={styles.input} value={gasto.categoriaId} onChange={(e) => handleMoveCategoria(gasto.id, e.target.value)}>
                                                        {Object.entries(estruturaCategorias).map(([id, cat]) => (
                                                            <option key={id} value={id}>{cat.nome}</option>
                                                        ))}
                                                    </select>

                                                    <button className={styles.button} onClick={() => handleEditGasto(gasto.id, { valor: parseFloat(valorEdit) })}>
                                                        Salvar
                                                    </button>
                                                    <button className={styles.buttonSecondary} onClick={() => setEditandoId(null)}>Cancelar</button>
                                                </>
                                            ) : (
                                                <>
                                                    <span>{gasto.descricao} – R${gasto.valor}</span>

                                                    <button className={styles.buttonSmall} onClick={() => {
                                                        setEditandoId(gasto.id);
                                                        setValorEdit(gasto.valor || 0);
                                                    }}>Editar</button>
                                                    <button className={styles.buttonSmallSecondary} onClick={() => handleRemoveGasto(gasto.id)}>Remover</button>
                                                </>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </section>
                <footer className={styles.footer}>
                    <button className={styles.logoffButton} onClick={() => {
                        localStorage.removeItem("userData");
                        usuarioRef.current = null;
                        router.push("/");
                    }}>Logoff</button>
                </footer>
            </div>
        </main>
    );
}

export async function getUserData() {
    try {
        const protocolo = process.env.NEXT_PUBLIC_API_PROTOCOL;
        const host = process.env.NEXT_PUBLIC_API_HOST;
        const port = process.env.NEXT_PUBLIC_API_PORT;
        const stored = localStorage.getItem("userData");
        const userId = stored ? JSON.parse(stored).userId : null;
        if (!userId) return null;
        const url = `${protocolo}://${host}:${port}/api/buscarusuario?id=${userId}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error("Falha API");
        const data = await res.json();
        localStorage.setItem("userData", JSON.stringify({
            userId: data.id, nome: data.nome, email: data.email, familia_id: data.familia_id
        }));
        return data;
    } catch (err) {
        const stored = localStorage.getItem("userData");
        return stored ? JSON.parse(stored) : null;
    }
}