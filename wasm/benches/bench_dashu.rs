use dashu::float::FBig;
use criterion::{criterion_group, criterion_main, Criterion};

fn calculate_old(prec: usize, max_iter: u32) {
    let mut zx: FBig = FBig::ZERO.with_precision(prec).value();
    let mut zy: FBig = FBig::ZERO.with_precision(prec).value();

    let cx: FBig = FBig::from(1).with_precision(prec).value();
    let cy: FBig = FBig::from(1).with_precision(prec).value();

    let f4: FBig = FBig::from(4).with_precision(prec).value();
    let f2: FBig = FBig::from(2).with_precision(prec).value();

    for _ in 0..max_iter {
        let zx2 = (&zx * &zx).with_precision(prec).value();
        let zy2 = (&zy * &zy).with_precision(prec).value();

        if &zx2 + &zy2 > f4 { }

        let new_zx = (&zx2 - &zy2 + &cx).with_precision(prec).value();
        let new_zy = ((&zx * &zy) * &f2 + &cy).with_precision(prec).value();

        zx = new_zx;
        zy = new_zy;
    }
}

fn calculate_no_alloc(prec: usize, max_iter: u32) {
    let mut zx: FBig = FBig::ZERO.with_precision(prec).value();
    let mut zy: FBig = FBig::ZERO.with_precision(prec).value();

    let cx: FBig = FBig::from(1).with_precision(prec).value();
    let cy: FBig = FBig::from(1).with_precision(prec).value();

    let f4: FBig = FBig::from(4).with_precision(prec).value();

    for _ in 0..max_iter {
        let zx2 = (&zx * &zx).with_precision(prec).value();
        let zy2 = (&zy * &zy).with_precision(prec).value();

        if &zx2 + &zy2 > f4 { }

        let mut new_zy = &zx * &zy;
        new_zy <<= 1;
        new_zy += &cy;
        zy = new_zy.with_precision(prec).value();

        let mut new_zx = zx2;
        new_zx -= &zy2;
        new_zx += &cx;
        zx = new_zx.with_precision(prec).value();
    }
}

fn criterion_benchmark(c: &mut Criterion) {
    c.bench_function("calc_old", |b| b.iter(|| calculate_old(std::hint::black_box(128), std::hint::black_box(1000))));
    c.bench_function("calc_no_alloc", |b| b.iter(|| calculate_no_alloc(std::hint::black_box(128), std::hint::black_box(1000))));
}

criterion_group!(benches, criterion_benchmark);
criterion_main!(benches);
