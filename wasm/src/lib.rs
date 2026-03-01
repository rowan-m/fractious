use wasm_bindgen::prelude::*;
use dashu::float::{FBig, DBig};
use std::str::FromStr;

#[wasm_bindgen]
pub fn init_hooks() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[wasm_bindgen]
pub struct Anchor {
    #[wasm_bindgen(getter_with_clone)]
    pub x: String,
    #[wasm_bindgen(getter_with_clone)]
    pub y: String,
    pub iter: u32,
}

fn to_fbig(d: DBig, prec: usize) -> FBig {
    // Correct way: d.to_binary().value().with_precision(prec).value()
    d.to_binary().value().with_precision(prec).value()
}

#[wasm_bindgen]
pub fn calculate_reference(c_re_str: String, c_im_str: String, max_iter: u32, prec: u32, abort_flag: Option<js_sys::Int32Array>) -> Vec<f32> {
    let prec = prec as usize;
    
    // Parse decimal strings directly to DBig
    let cx_d = DBig::from_str(&c_re_str).unwrap_or_else(|_| DBig::ZERO);
    let cy_d = DBig::from_str(&c_im_str).unwrap_or_else(|_| DBig::ZERO);
    
    let cx = to_fbig(cx_d, prec);
    let cy = to_fbig(cy_d, prec);
    
    // Initialize Z (zero)
    let mut zx = FBig::ZERO.with_precision(prec).value();
    let mut zy = FBig::ZERO.with_precision(prec).value();
    
    let mut orbit = Vec::with_capacity((max_iter as usize) * 2);
    
    // Constant 4.0 and 2.0
    let f4: FBig = FBig::from(4).with_precision(prec).value();
    let f2: FBig = FBig::from(2).with_precision(prec).value();
    
    for iter_idx in 0..max_iter {
        if iter_idx % 1000 == 0 {
            if let Some(ref flag) = abort_flag {
                if flag.get_index(0) != 0 {
                    break;
                }
            }
        }
        
        // Output f64: use to_f64() -> value()
        let zx_f64 = zx.to_f64().value();
        let zy_f64 = zy.to_f64().value();
        orbit.push(zx_f64 as f32);
        orbit.push(zy_f64 as f32);
        
        let zx2 = (&zx * &zx).with_precision(prec).value();
        let zy2 = (&zy * &zy).with_precision(prec).value();
        
        if &zx2 + &zy2 > f4 {
            break;
        }
        
        // new_zx = zx2 - zy2 + cx
        let new_zx = (&zx2 - &zy2 + &cx).with_precision(prec).value();
        
        // new_zy = 2*zx*zy + cy
        let new_zy = ((&zx * &zy) * &f2 + &cy).with_precision(prec).value();
        
        zx = new_zx;
        zy = new_zy;
    }
    
    // Pad with 0.0 effectively stopping the reference influence
    while orbit.len() < (max_iter as usize) * 2 {
        orbit.push(0.0);
        orbit.push(0.0);
    }
    
    orbit
}

#[wasm_bindgen]
pub fn add_coord(val: String, delta: f64) -> String {
    let r_d = DBig::from_str(&val).unwrap_or_else(|_| DBig::ZERO);
    // Convert f64 -> String -> DBig
    let d_d = DBig::from_str(&delta.to_string()).unwrap_or_else(|_| DBig::ZERO);
    
    let res = r_d + d_d;
    res.to_string()
}

#[wasm_bindgen]
pub fn sub_coord(val1: String, val2: String) -> f64 {
    let v1 = DBig::from_str(&val1).unwrap_or_else(|_| DBig::ZERO);
    let v2 = DBig::from_str(&val2).unwrap_or_else(|_| DBig::ZERO);
    let diff = v1 - v2;
    diff.to_f64().value()
}

// Return tuple [x_str, y_str]
#[wasm_bindgen]
pub fn find_best_anchor(cx_str: String, cy_str: String, scale: f64, aspect: f64, max_iter: u32, prec: u32) -> Anchor {
    let prec = prec as usize;
    let center_x = DBig::from_str(&cx_str).unwrap_or_else(|_| DBig::ZERO);
    let center_y = DBig::from_str(&cy_str).unwrap_or_else(|_| DBig::ZERO);
    
    let cx_f64 = center_x.to_f64().value();
    let cy_f64 = center_y.to_f64().value();
    
    let step_x_f64 = scale * 0.22 * aspect;
    let step_y_f64 = scale * 0.22;
    
    let mut best_iter_f64 = 0;
    let mut best_ox_i = 0;
    let mut best_oy_i = 0;
    
    // Evaluate in center-out order to prefer center if tied
    let offsets = [
        (0, 0),
        (-1, 0), (1, 0), (0, -1), (0, 1),
        (-1, -1), (1, -1), (-1, 1), (1, 1),
        (-2, 0), (2, 0), (0, -2), (0, 2),
        (-2, -1), (-2, 1), (2, -1), (2, 1),
        (-1, -2), (1, -2), (-1, 2), (1, 2),
        (-2, -2), (2, -2), (-2, 2), (2, 2),
    ];
    
    for &(ox_i, oy_i) in offsets.iter() {
        let cx = cx_f64 + (ox_i as f64) * step_x_f64;
        let cy = cy_f64 + (oy_i as f64) * step_y_f64;
        
        let mut zx = 0.0;
        let mut zy = 0.0;
        let mut i = 0;
        
        while i < max_iter {
            let zx2 = zx * zx;
            let zy2 = zy * zy;
            if zx2 + zy2 > 4.0 {
                break;
            }
            let new_zx = zx2 - zy2 + cx;
            let new_zy = 2.0 * zx * zy + cy;
            zx = new_zx;
            zy = new_zy;
            i += 1;
        }
        
        if i > best_iter_f64 {
            best_iter_f64 = i;
            best_ox_i = ox_i;
            best_oy_i = oy_i;
            if i >= max_iter {
                break; 
            }
        }
    }
    
    // Scale is the vertical span (approx).
    // Multiply x-step by aspect to cover wide screen
    let step_y_dbig = DBig::from_str(&(scale * 0.22).to_string()).unwrap_or_else(|_| DBig::ZERO);
    let step_x_dbig = DBig::from_str(&(scale * 0.22 * aspect).to_string()).unwrap_or_else(|_| DBig::ZERO);
    
    let dx_val = DBig::from_str(&(best_ox_i as f64).to_string()).unwrap_or_else(|_| DBig::ZERO);
    let dy_val = DBig::from_str(&(best_oy_i as f64).to_string()).unwrap_or_else(|_| DBig::ZERO);
    
    let best_cx = &center_x + (&step_x_dbig * dx_val);
    let best_cy = &center_y + (&step_y_dbig * dy_val);
    
    // Evaluate the single chosen point using BigFloat to get its true iteration count
    let cx_big = to_fbig(best_cx.clone(), prec);
    let cy_big = to_fbig(best_cy.clone(), prec);
    
    let mut zx_big = FBig::ZERO.with_precision(prec).value();
    let mut zy_big = FBig::ZERO.with_precision(prec).value();
    
    let f4: FBig = FBig::from(4).with_precision(prec).value();
    let f2: FBig = FBig::from(2).with_precision(prec).value();
    
    let mut true_iter = 0;
    while true_iter < max_iter {
        let zx2 = (&zx_big * &zx_big).with_precision(prec).value();
        let zy2 = (&zy_big * &zy_big).with_precision(prec).value();
        
        if &zx2 + &zy2 > f4 {
            break;
        }
        
        let new_zx = (&zx2 - &zy2 + &cx_big).with_precision(prec).value();
        let new_zy = ((&zx_big * &zy_big) * &f2 + &cy_big).with_precision(prec).value();
        
        zx_big = new_zx;
        zy_big = new_zy;
        true_iter += 1;
    }
    
    Anchor {
        x: best_cx.to_string(),
        y: best_cy.to_string(),
        iter: true_iter,
    }
}