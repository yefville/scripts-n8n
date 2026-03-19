const { chromium } = require('playwright');     
const fs = require('fs');
const path = require('path');

/* =============================================
   SISTEMA DE SEGURIDAD Y CIERRE
   ============================================= */
let _browser = null, _stopped = false;
function finish(data, exitCode = 0) {
    if (_stopped) return; _stopped = true;
    console.log(JSON.stringify(data));
    try { if (_browser) _browser.disconnect(); } catch (e) { }
    setTimeout(() => { process.exit(exitCode); }, 1000);
}

/* =============================================
   FUNCIÓN ASEGURAR ESTADO (LA QUE SÍ FUNCIONA)
   ============================================= */
const asegurarEstado = async (page, modoDeseado, opciones) => {
    console.error(`FLOW: Cambiando a ${modoDeseado}`);

    const btnPanel = page.locator('button[aria-haspopup="menu"]').last();
    await btnPanel.click({ force: true });
    await page.waitForTimeout(1000);

    const tab = page.locator('button[role="tab"]', { hasText: modoDeseado }).first();
    await tab.click({ force: true });

    await page.waitForTimeout(800);

    for (const opt of opciones) {
        const optTab = page.locator('button[role="tab"]', { hasText: opt }).first();
        if (await optTab.count()) {
            await optTab.click({ force: true });
            await page.waitForTimeout(500);
        }
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
};

(async () => {
    try {
        const pImgB64 = process.argv[2] || '';
        const pAnimB64 = process.argv[3] || '';
        const savePath = process.argv[4] || '';

        const promptImagen = Buffer.from(pImgB64, 'base64').toString('utf-8');
        const promptAnimacion = Buffer.from(pAnimB64, 'base64').toString('utf-8');

        try { _browser = await chromium.connectOverCDP('http://192.168.65.254:9222'); }
        catch { _browser = await chromium.connectOverCDP('http://127.0.0.1:9222'); }

        const ctx = _browser.contexts()[0];
        let page = ctx.pages().find(p => p.url().includes('/tools/flow/project/'));
        if (!page) {
            page = await ctx.newPage();
            await page.goto('https://labs.google/fx/es/tools/flow');
            await page.waitForTimeout(3000);
        }
        await page.bringToFront();

        // --- PASO 1: GENERAR IMAGEN ---
        await asegurarEstado(page, 'Imagen', ['Vertical', 'x1']);

        const editor = page.locator('div[data-slate-editor="true"]').first();
        await editor.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(promptImagen);

        const prevImgs = await page.evaluate(() => Array.from(document.querySelectorAll('img')).map(i => i.src));
        await page.keyboard.press('Enter');

        console.error("FLOW: Generando imagen base (45s)...");
        await page.waitForTimeout(45000);

        // 🔄 RECARGA DESPUÉS DE GENERAR IMAGEN
        console.error("FLOW: Recargando página después de generar imagen...");
        await page.reload();
        await page.waitForTimeout(5000);

        // --- PASO 2: CAMBIAR A MODO VIDEO ---
        await asegurarEstado(page, 'Video', ['Frames', 'Vertical', 'x1']);

        // --- PASO 3: ADJUNTAR IMAGEN ---
        console.error("FLOW: Adjuntando imagen generada a la instrucción...");
        const imgElement = await page.evaluateHandle((old) => {
            return Array.from(document.querySelectorAll('img')).reverse().find(img => img.src.includes('getMediaUrlRedirect') && !old.includes(img.src));
        }, prevImgs);

        if (imgElement) {
            await imgElement.asElement().click({ button: 'right' });
            await page.waitForTimeout(1000);
            await page.getByRole('menuitem', { name: /instrucción|petición|prompt/i }).first().click();
            await page.waitForTimeout(2500);
        } else {
            throw new Error("No se encontró la nueva imagen para adjuntar.");
        }

        // --- PASO 4: ANIMAR Y DESCARGAR ---
        console.error("FLOW: Enviando prompt de animación...");
        await editor.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(promptAnimacion);

        const oldVids = await page.evaluate(() => Array.from(document.querySelectorAll('video')).map(v => v.src));
        await page.keyboard.press('Enter');

        console.error("FLOW: Generando video...");
        await page.waitForFunction((prev) => {
            const vids = Array.from(document.querySelectorAll('video'));
            return vids.some(v => v.src && !prev.includes(v.src));
        }, oldVids, { timeout: 900000 });

        const videoB64 = await page.evaluate(async (prev) => {
            const v = Array.from(document.querySelectorAll('video')).find(v => v.src && !prev.includes(v.src));
            const r = await fetch(v.src);
            const b = await r.blob();
            return new Promise(res => {
                const rd = new FileReader();
                rd.onloadend = () => res(rd.result.split(',')[1]);
                rd.readAsDataURL(b);
            });
        }, oldVids);

        fs.writeFileSync(savePath, Buffer.from(videoB64, 'base64'));

        // ⏳ ESPERA ANTES DE RECARGAR (NUEVO)
        await page.waitForTimeout(3000);

        // 🔄 RECARGA DESPUÉS DE DESCARGAR VIDEO
        console.error("FLOW: Recargando página después de descargar video...");
        await page.reload();
        await page.waitForTimeout(5000);

        finish({ success: true, filePath: savePath });

    } catch (err) {
        console.error("FLOW ERROR:", err.message);
        finish({ success: false, error: err.message }, 1);
    }
})();
