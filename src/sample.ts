import { IPostgresConnection, UserEntity, PostgresUnitOfWork, IUnitOfWork, GroupEntity } from "./repository_impl";

// sample

function getUow(): IUnitOfWork {
    const groupsObject = [
        new GroupEntity(),
        new GroupEntity(),
    ];
    return new PostgresUnitOfWork(new FakeIPostgresConnection(), groupsObject);
}

export default async function sample() {
    console.log('Start UOW');
    const uow = getUow();
    const kp71Students = await uow.users.applyManySelector(uow.usersDao.getStudentsByGroupId('kp71'));
    console.log('kp71Students', kp71Students);
    const u1 = await uow.users.get("0");
    await uow.users.get("0");
    const u2 = await uow.users.get("1");
    const u3 = await uow.users.get("2");

    if (u1) {
        u1.fullname = "Hello";
    }  
    if (u2) {
        uow.users.remove(u2);
    }
    if (u1) {
        u1.fullname = "";
    }  
    if (u3) {
        u3.fullname = "A Three 000";
    }  
    const newU = new UserEntity(3, "333");
    uow.users.add(newU);
    newU.fullname = "Changed!";
    uow.commit();
}

class FakeIPostgresConnection implements IPostgresConnection {
    
    query<TResult>(request: string, data?: any[] | undefined): Promise<TResult> {
        return this.logMany('query', request, data);
    }
    oneOrNone<TResult>(request: string, data?: any[] | undefined): Promise<TResult | undefined> {
        return this.log('oneOrMany', request, data);
    }
    mutation(request: string, data?: any[] | undefined): Promise<void> {
        return this.log('mutation', request, data);
    }

    private log(name: string, request: string, data?: any[] | undefined): Promise<any> {
        console.log(name, request, data);
        const id = data ? data[0] as number : 0;
        const entity = new UserEntity(id, id.toString());
        entity.fullname = "";
        return Promise.resolve(entity);
    }

    private logMany(name: string, request: string, data?: any[] | undefined): Promise<any> {
        console.log(name, request, data);
        const id = data ? data[0] as number : 0;
        const entity = new UserEntity(id, id.toString());
        entity.fullname = "";
        return Promise.resolve([entity]);
    }
}
