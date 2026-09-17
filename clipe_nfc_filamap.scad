
$fn = 90;

// Parâmetros do Clipe em Ômega
clip_width = 12.0;       // Largura do corpo do clipe
clip_thickness = 2.4;   // Espessura da mola
inner_r = 5.0;          // Raio interno do arco
opening_gap = 4.0;      // Encaixe da borda do carretel
arm_len = 16.0;         // Comprimento da perna

// Parâmetros do Berço NFC
nfc_tag_dia = 25.4;     // Diâmetro do adesivo NTAG213/215
nfc_recess_depth = 1.0; // Rebaixo para proteger o adesivo
disc_dia = 28.0;        // Diâmetro externo da orelha
disc_thick = 2.2;       // Espessura da orelha

module clipe_omega() {
    difference() {
        union() {
            // Arco superior
            cylinder(r = inner_r + clip_thickness, h = clip_width, center = true);
            // Perna esquerda (face de fixação da tag)
            translate([-(inner_r + clip_thickness/2), -arm_len/2, 0])
                cube([clip_thickness, arm_len, clip_width], center = true);
            // Perna direita com chanfro
            translate([(inner_r + clip_thickness/2), -arm_len/2, 0])
                cube([clip_thickness, arm_len, clip_width], center = true);
            // Aba de saída para facilitar encaixe
            translate([(inner_r + clip_thickness/2) + 1.5, -arm_len + 1, 0])
                rotate([0, 0, 35])
                cube([clip_thickness, 4, clip_width], center = true);
        }
        // Abertura interna do ômega
        cylinder(r = inner_r, h = clip_width + 2, center = true);
        translate([0, -arm_len/2, 0])
            cube([opening_gap, arm_len + 2, clip_width + 2], center = true);
    }
    
    // Dente serrilhado para prender a ponta do filamento 1.75mm
    translate([(inner_r + clip_thickness/2) - 0.8, -arm_len/2, 0])
        cylinder(r = 0.9, h = clip_width, center = true);
}

module berco_nfc() {
    difference() {
        // Disco estrutural externo
        cylinder(d = disc_dia, h = disc_thick, center = true);
        // Nicho embutido para a tag NFC
        translate([0, 0, (disc_thick - nfc_recess_depth) / 2 + 0.05])
            cylinder(d = nfc_tag_dia, h = nfc_recess_depth + 0.1, center = true);
    }
}

// Fusão do Clipe com a Orelha NFC
union() {
    clipe_omega();
    // Posiciona o disco na lateral da perna externa
    translate([-(inner_r + clip_thickness) - disc_thick/2 + 0.2, -arm_len/2 + 1.5, 0])
        rotate([0, 90, 0])
        berco_nfc();
}
