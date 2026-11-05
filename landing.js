// Landing: simulador (mesma regra de config.js / server/split.js: aula padrão de R$ 100,00 para 0,5 a 3 horas) e barra fixa do celular.
(function () {
    var PRECO = 10000, MIN_H = 0.5, MAX_H = 3;
    var $ = function (id) { return document.getElementById(id); };
    var brl = function (c) { return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " "); };
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

    // A barra "Quero treinar" só aparece depois que o hero sai da tela (não repete os botões que já estão visíveis).
    var dock = $("dock"), hero = document.querySelector(".hero");
    if (dock && hero && "IntersectionObserver" in window) {
        new IntersectionObserver(function (e) { dock.classList.toggle("on", !e[0].isIntersecting); }, { threshold: 0 }).observe(hero);
    } else if (dock) { dock.classList.add("on"); }
})();
