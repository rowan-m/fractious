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

macro_rules! console_log {
    ($($t:tt)*) => (log(&format!($($t)*)))
}

// Precision is now dynamic

fn to_fbig(d: DBig, prec: usize) -> FBig {
    // Correct way: d.to_binary().value().with_precision(prec).value()
    d.to_binary().value().with_precision(prec).value()
}

#[wasm_bindgen]
pub fn calculate_reference(c_re_str: String, c_im_str: String, max_iter: u32, prec: u32) -> Vec<f64> {
    let prec = prec as usize;
    // console_log!("Rust: Reference calc start (Dashu). Prec: {}. Iter: {}", prec, max_iter);
    
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
    
    for _ in 0..max_iter {
        // Output f64: use to_f64() -> value()
        let zx_f64 = zx.to_f64().value();
        let zy_f64 = zy.to_f64().value();
        orbit.push(zx_f64);
        orbit.push(zy_f64);
        
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
    
    // console_log!("Rust: Reference calc done.");
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
pub fn find_best_anchor(cx_str: String, cy_str: String, scale: f64, aspect: f64, max_iter: u32, prec: u32) -> Vec<String> {
    let prec = prec as usize;
    let center_x = DBig::from_str(&cx_str).unwrap_or_else(|_| DBig::ZERO);
    let center_y = DBig::from_str(&cy_str).unwrap_or_else(|_| DBig::ZERO);
    
    // Scale is the vertical span (approx).
    // Multiply x-step by aspect to cover wide screen
    // Dense Grid: Step 0.22 allows 5 points (-2 to 2) to cover approx -0.44 to 0.44 (90% view)
    let step_y = DBig::from_str(&(scale * 0.22).to_string()).unwrap_or_else(|_| DBig::ZERO);
    let step_x = DBig::from_str(&(scale * 0.22 * aspect).to_string()).unwrap_or_else(|_| DBig::ZERO);
    
    let mut best_iter = 0;
    // Default to center
    let mut best_dbig = (center_x.clone(), center_y.clone());
    
    let f4: FBig = FBig::from(4).with_precision(prec).value();
    let f2: FBig = FBig::from(2).with_precision(prec).value();
    
    // 3x3 Grid Search (-1..=1) - Reduced from 5x5 for performance
    for oy_i in -1..=1 {
        for ox_i in -1..=1 {
            // Check Center? (0,0) is included.
            
            let ox = ox_i as f64;
            let oy = oy_i as f64;
            
            let dx_val = DBig::from_str(&ox.to_string()).unwrap_or_else(|_| DBig::ZERO);
            let dy_val = DBig::from_str(&oy.to_string()).unwrap_or_else(|_| DBig::ZERO);
            
            // Apply separate steps
            let dx = &step_x * dx_val;
            let dy = &step_y * dy_val;
            
            let cx_probe = &center_x + &dx;
            let cy_probe = &center_y + &dy;
            
            let cx = to_fbig(cx_probe.clone(), prec);
            let cy = to_fbig(cy_probe.clone(), prec);
            
            let mut zx = FBig::ZERO.with_precision(prec).value();
            let mut zy = FBig::ZERO.with_precision(prec).value();
            
            let mut i = 0;
            loop {
                 if i >= max_iter { break; }
                 
                 let zx2 = (&zx * &zx).with_precision(prec).value();
                 let zy2 = (&zy * &zy).with_precision(prec).value();
                 
                 if &zx2 + &zy2 > f4 {
                     break;
                 }
                 
                 let new_zx = (&zx2 - &zy2 + &cx).with_precision(prec).value();
                 let new_zy = ((&zx * &zy) * &f2 + &cy).with_precision(prec).value();
                 
                 zx = new_zx;
                 zy = new_zy;
                 i += 1;
            }
            
            if i > best_iter {
                best_iter = i;
                best_dbig = (cx_probe, cy_probe);
                
                if i >= max_iter {
                   // Found a point that hits the limit (in set or extremely deep)
                   // Breaking early reduces cost of dense search
                   break; 
                }
            }
        }
        if best_iter >= max_iter { break; }
    }
    
    vec![best_dbig.0.to_string(), best_dbig.1.to_string()]
}
