use criterion::{criterion_group, criterion_main, Criterion};
use dashu::float::FBig;
use dashu::float::round::mode::Zero;

fn bench_calculation(c: &mut Criterion) {
    let prec = 1000;

    let zx: FBig<Zero> = FBig::ZERO.with_precision(prec).value();
    let zy: FBig<Zero> = FBig::ZERO.with_precision(prec).value();
    let cx: FBig<Zero> = FBig::from(1).with_precision(prec).value();
    let cy: FBig<Zero> = FBig::from(1).with_precision(prec).value();
    let f4: FBig<Zero> = FBig::from(4).with_precision(prec).value();

    c.bench_function("calc_old", |b| b.iter(|| {
        let mut zx_clone = zx.clone();
        let mut zy_clone = zy.clone();
        for _ in 0..100 {
            let zx2: FBig<Zero> = (&zx_clone * &zx_clone).with_precision(prec).value();
            let zy2: FBig<Zero> = (&zy_clone * &zy_clone).with_precision(prec).value();
            if &zx2 + &zy2 > f4 { break; }
            let mut new_zy = &zx_clone * &zy_clone;
            new_zy <<= 1;
            new_zy += &cy;
            zy_clone = new_zy.with_precision(prec).value();
            let mut new_zx = zx2;
            new_zx -= &zy2;
            new_zx += &cx;
            zx_clone = new_zx.with_precision(prec).value();
        }
    }));
}

fn bench_calculation_new(c: &mut Criterion) {
    let prec = 1000;
    let zx: FBig<Zero> = FBig::ZERO.with_precision(prec).value();
    let zy: FBig<Zero> = FBig::ZERO.with_precision(prec).value();
    let cx: FBig<Zero> = FBig::from(1).with_precision(prec).value();
    let cy: FBig<Zero> = FBig::from(1).with_precision(prec).value();
    let f4: FBig<Zero> = FBig::from(4).with_precision(prec).value();

    c.bench_function("calc_new", |b| b.iter(|| {
        let mut zx_clone = zx.clone();
        let mut zy_clone = zy.clone();
        for _ in 0..100 {
            let zx2: FBig<Zero> = (&zx_clone * &zx_clone).with_precision(prec).value();
            let zy2: FBig<Zero> = (&zy_clone * &zy_clone).with_precision(prec).value();

            if &zx2 + &zy2 > f4 { break; }

            let mut new_zy = zx_clone;
            new_zy *= &zy_clone;
            new_zy <<= 1;
            new_zy += &cy;
            zy_clone = new_zy.with_precision(prec).value();

            let mut new_zx = zx2;
            new_zx -= &zy2;
            new_zx += &cx;
            zx_clone = new_zx.with_precision(prec).value();
        }
    }));
}

criterion_group!(benches2, bench_calculation, bench_calculation_new);
criterion_main!(benches2);
