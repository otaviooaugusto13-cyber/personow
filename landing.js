// Simulador: mesma regra de config.js / server/split.js (aula fixa de R$ 100,00 por aula de 0,5 a 3 horas)
(function () {
    var PRECO = 10000, MIN_H = 0.5, MAX_H = 3;
    var $ = function (id) { return document.getElementById(id); };
    var brl = function (c) { return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, "\u00a0"); };
    function calcular() {
        var h = parseFloat(String($("calc-valor").value).replace(",", ".")), ok = h >= MIN_H && h <= MAX_H;
        $("calc-erro").hidden = ok;
        $("calc-valor").setAttribute("aria-invalid", ok ? "false" : "true");
        if (!ok) return;
        $("calc-servico").textContent = brl(PRECO);
        $("calc-total").textContent = brl(PRECO);
    }
    $("calc-valor").addEventListener("input", calcular);
    calcular();
})();
