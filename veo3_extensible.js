const { chromium } = require('playwright');     
const fs = require('fs');
const path = require('path');

/* =============================================
   SISTEMA DE SEGURIDAD Y CIERRE (EL QUE FUNCIONA)
   ============================================= */
let _browser = null, _stopped = false;
function finish(data, exitCode = 0) {
    if (_stopped) return;
    _stopped = true;

    // IMPORTANTE: Imprimimos el JSON para que n8n capture la salida y finalice el nodo
    console.log(JSON.stringify(data));

    try {
        if (_browser) {
            // Cerramos todo rápido para evitar que n8n se quede colgado
            _browser.close().catch(() => {});
        }
    } catch (e) { }

    // Matamos el proceso para asegurar que n8n vea el fin de la ejecución
    process.exit(exitCode);
}

/* =============================================
   FUNCIONES DE INTERFAZ
   ============================================= */
const asegurarEstado = async (page, modoDeseado, opciones) => {
    console.error(`FLOW: Configurando modo ${modoDeseado}...`);
    const btnPanel = page.locator('button[id^="radix-"][aria-haspopup="menu"]').last();
    await btnPanel.click();
    await page.waitForTimeout(1500);

    await page.evaluate((m) => {
        const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
        const target = tabs.find(t => t.innerText.includes(m));
        if (target) {
            target.click();
            ['mousedown', 'mouseup', 'click'].forEach(e => target.dispatchEvent(new MouseEvent(e, { bubbles: true })));
        }
    }, modoDeseado);
    await page.waitForTimeout(1500);

    for (const opt of opciones) {
        await page.evaluate((texto) => {
            const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
            const target = tabs.find(t => t.innerText.includes(texto));
            if (target && target.getAttribute('aria-selected') !== 'true') target.click();
        }, opt);
        await page.waitForTimeout(700);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
};

(async () => {
    try {
        const cadenaPromptsUnidos = process.argv[2] || '';
        // Si pasas un archivo, el script tomará la carpeta donde está ese archivo
        let baseFolder = process.argv[3] || '/home/node/shared/';
        if (baseFolder.endsWith('.mp4')) baseFolder = path.dirname(baseFolder);

        const listaPrompts = cadenaPromptsUnidos.split('|').map(p64 =>
            Buffer.from(p64, 'base64').toString('utf-8')
        );

        const promptInicial = listaPrompts[0];
        const promptsExtender = listaPrompts.slice(1);

        try { _browser = await chromium.connectOverCDP('http://127.0.0.1:9222'); }
        catch { _browser = await chromium.connectOverCDP('http://192.168.65.254:9222'); }

        const ctx = _browser.contexts()[0];
        let page = ctx.pages().find(p => p.url().includes('/tools/flow'));
        await page.bringToFront();

        // --- PASO 1: MODO VIDEO ---
        await asegurarEstado(page, 'Video', ['Vertical', 'Veo 3.1 - Fast']);

        // --- PASO 2: GENERAR PRIMERO ---
        const assetsAntes = await page.evaluate(() => ({
            imgs: Array.from(document.querySelectorAll('img')).map(i => i.src),
            vids: Array.from(document.querySelectorAll('video')).map(v => v.src)
        }));

        const editor = page.locator('div[data-slate-editor="true"]').first();
        await editor.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(promptInicial);
        await page.keyboard.press('Enter');

        await page.waitForFunction((antes) => {
            const current = Array.from(document.querySelectorAll('img, video')).map(a => a.src);
            return current.some(src => !antes.imgs.includes(src) && !antes.vids.includes(src));
        }, assetsAntes, { timeout: 300000 });

        // --- PASO 3: ENTRAR AL EDITOR Y LOWER PRIORITY ---
        const firstAsset = await page.evaluateHandle((antes) => {
            const newImg = Array.from(document.querySelectorAll('img')).reverse().find(i => !antes.imgs.includes(i.src));
            return newImg || Array.from(document.querySelectorAll('video')).reverse().find(v => !antes.vids.includes(v.src));
        }, assetsAntes);
        await firstAsset.asElement().click({ force: true });
        await page.waitForTimeout(4000);

        const modelSelector = page.locator('button').filter({ hasText: /Veo 3\.1/ }).last();
        if (await modelSelector.isVisible()) {
            await modelSelector.click();
            await page.waitForTimeout(1000);
            await page.getByRole('menuitem').filter({ hasText: /Lower Priority/i }).click();
            await page.waitForTimeout(1500);
        }

        // --- PASO 4: BUCLE DE EXTENSIONES ---
        for (let i = 0; i < promptsExtender.length; i++) {
            console.error(`FLOW: Extendiendo escena ${i + 1}...`);
            const currentVids = await page.evaluate(() => Array.from(document.querySelectorAll('video')).map(v => v.src));
            const extendEditor = page.locator('div[data-slate-editor="true"]').last();
            await extendEditor.click();
            await page.keyboard.press('Control+A');
            await page.keyboard.press('Backspace');
            await page.keyboard.type(promptsExtender[i]);
            await page.keyboard.press('Enter');

            await page.waitForFunction((prev) => {
                const vids = Array.from(document.querySelectorAll('video'));
                return vids.some(v => v.src && !prev.includes(v.src));
            }, currentVids, { timeout: 400000 });
            await page.waitForTimeout(3000);
        }

        // --- PASO 5: DESCARGAR TODAS LAS PIEZAS ---
        console.error("FLOW: Esperando 10s para descargar fragmentos...");
        await page.waitForTimeout(10000);

        const downloadedFiles = [];
        const urlsSegmentos = await page.evaluate(() => {
            const sidebar = document.querySelector('aside') || document.body;
            return Array.from(sidebar.querySelectorAll('video, img'))
                .map(el => el.src)
                .filter(src => src && (src.includes('getMediaUrlRedirect') || src.includes('blob:')))
                .filter((v, i, s) => s.indexOf(v) === i);
        });

        for (let j = 0; j < urlsSegmentos.length; j++) {
            const piezaB64 = await page.evaluate(async (url) => {
                const r = await fetch(url);
                const b = await r.blob();
                return new Promise(res => {
                    const rd = new FileReader();
                    rd.onloadend = () => res(rd.result.split(',')[1]);
                    rd.readAsDataURL(b);
                });
            }, urlsSegmentos[j]);

            if (piezaB64) {
                const fileName = `pieza_${Date.now()}_${j}.mp4`;
                const filePath = path.join(baseFolder, fileName);
                fs.writeFileSync(filePath, Buffer.from(piezaB64, 'base64'));
                downloadedFiles.push(filePath);
            }
        }

        // --- PASO 6: CIERRE DEFINITIVO ---
        console.error("FLOW: Finalizado. Cerrando editor.");
        await page.getByRole('button', { name: /listo|done/i }).click().catch(() => page.keyboard.press('Escape'));

        // FINALIZAR: Esto enviará el éxito a n8n
        finish({
            success: true,
            files: downloadedFiles,
            count: downloadedFiles.length
        });

    } catch (err) {
        console.error("FLOW ERROR:", err.message);
        finish({ success: false, error: err.message }, 1);
    }
})();