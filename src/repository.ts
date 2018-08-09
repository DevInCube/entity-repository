// https://msdn.microsoft.com/en-us/library/system.data.entitystate(v=vs.110).aspx
export enum EntityState {
    Detached,
	Unchanged,
	Added,
	Modified,
	Deleted,
}

export abstract class Entity {

    originalValues: {[key: string]: any} = {};
    entityState: EntityState = EntityState.Detached;

    abstract get Id(): string;

    constructor() {
        return new Proxy(this, {
            set(object: {[key: string]: any} & Entity, key: string, value: any, proxy: any) {

                const originalValue = object.originalValues[key];
                const currentValue = object[key];

                if (key !== 'entityState' 
                    && object.entityState !== EntityState.Detached
                    && value !== currentValue) {
                    
                    // console.log('UDP', key, originalValue, currentValue, value);
                    if (originalValue === undefined) {
                        object.originalValues[key] = currentValue;
                        if (object.entityState === EntityState.Unchanged) {
                            object.entityState = EntityState.Modified;
                            console.log('Entity modified');
                        }
                        console.log(`Entity field updated [${key}]: '${currentValue}' -> '${value}'`);
                    } else if (originalValue === value) {
                        delete object.originalValues[key];
                        if (Object.keys(object.originalValues).length === 0) {
                            object.entityState = EntityState.Unchanged;
                            console.log('Entity become unchanged');
                        }
                        console.log(`Entity field become original [${key}]: '${originalValue}'`);
                    }
                }
                object[key] = value;
                return true;
            }
        });
    }

    cancelChanges(): void {
        for (const [k, v] of Object.entries(this.originalValues)) {
            (this as {[key: string]: any})[k] = v;
        }
    }
}

export interface IReadOnlyRepository<TEntity extends Entity> {
    get(id: string): Promise<TEntity | undefined>;
    getAll(): Promise<TEntity[]>;
    applySingleSelector(selector: SingleSelector<TEntity>): Promise<TEntity | undefined>;
    applyManySelector(selector: ManySelector<TEntity>): Promise<TEntity[]>;
}

export interface IRepository<TEntity extends Entity> extends IReadOnlyRepository<TEntity> {
    add(entity: TEntity): void;
    remove(entity: TEntity): void;
}

export interface IChangeTracker {
    saveChanges(): Promise<void>;
    cancelChanges(): void;
}

export class Tracker<T extends Entity> {

    protected entities: {[id: string]: T} = {};

    get changes() { return Object.values(this.entities); }

    attach(entity: T): T {
        this.entities[entity.Id] = entity;
        entity.entityState = EntityState.Unchanged;
        return entity;
    }

    detach(entity: T): T {
        delete this.entities[entity.Id];
        entity.entityState = EntityState.Detached;
        return entity;
    }

    attachIf(entity: T | undefined): T | undefined {
        if (entity) {
            this.attach(entity);
        }
        return entity;
    }

    get(id: string): T | undefined {
        return this.entities[id];
    }
}

export class ChangeTracker<T extends Entity> extends Tracker<T> implements IChangeTracker {

    constructor(private dao: IDao<T>) {
        super();
    }

    insert(entity: T) {
        //
        // checked cached
        const existingEntity = this.entities[entity.Id];
        if (existingEntity) { throw new Error(`Entity already exists`); }
        //
        entity.entityState = EntityState.Added;
        this.entities[entity.Id] = entity;
    }

    delete(entity: T) {
        //
        // checked cached
        const existingEntity = this.entities[entity.Id];
        if (!existingEntity) { throw new Error(`Entity doesn't exist`); }
        //
        entity.entityState = EntityState.Deleted;
    }

    //

    async saveChanges() {
        const entities = Object.values(this.changes);
        // console.log(entities);
        
        const toDelete = entities.filter(x => x.entityState === EntityState.Deleted);
        const deleter = this.dao.deleter();
        if (deleter) {
            for (const e of toDelete) {
                await deleter(e);
                e.entityState = EntityState.Deleted;
            }
        }

        const toInsert = entities.filter(x => x.entityState === EntityState.Added);
        const creator = this.dao.creator();
        if (creator) {
            for (const e of toInsert) {
                await creator(e);  // @todo get id?
                e.entityState = EntityState.Unchanged;
            }
        }
        
        const toUpdate = entities.filter(x => x.entityState === EntityState.Modified);
        const updater = this.dao.updater();
        if (updater) {
            for (const e of toUpdate) {
                await updater(e);
                e.entityState = EntityState.Unchanged;
            }
        }
    }

    cancelChanges() {
        const entities = Object.values(this.changes);
        const toDelete = entities.filter(x => x.entityState === EntityState.Deleted);
        for (const e of toDelete) {
            e.entityState = EntityState.Unchanged;
        }
        const toInsert = entities.filter(x => x.entityState === EntityState.Added);
        for (const e of toInsert) {
            this.detach(e);
        }
        const toUpdate = entities.filter(x => x.entityState === EntityState.Modified);
        for (const e of toUpdate) {
            e.cancelChanges();
        }
    }
}

// export interface IUserRepository extends IRepository<UserEntity> {
// 	getByBitbucketId(id: string): Promise<UserEntity | undefined>;
// 	getByName(name: string): Promise<UserEntity | undefined>;
// 	getByApiCredentials(username: string, password: string): Promise<UserEntity | undefined>;
// 	getByYear(year: number): Promise<UserEntity[]>;
// 	getGuestStudents(): Promise<UserEntity[]>;
// 	getStudentsByGroupId(groupId: string): Promise<UserEntity[]>;
// }

export type SingleSelector<T extends Entity> = (() => Promise<T | undefined>);
export type ManySelector<T extends Entity> = (() => Promise<T[]>);
export type Mutator<T extends Entity> = ((entity: T) => Promise<void>) | undefined;

export interface IReadOnlyDao<T extends Entity> {
    singleSelector(id: string): SingleSelector<T>;
    manySelector(): ManySelector<T>;
}

export interface IDao<T extends Entity> extends IReadOnlyDao<T> {
    creator(): Mutator<T>;
    updater(): Mutator<T>;
    deleter(): Mutator<T>;
}

export abstract class ReadOnlyRepository<T extends Entity> implements IReadOnlyRepository<T> {
    constructor(
        private commonReadOnlyDao: IReadOnlyDao<T>,
        protected tracker: Tracker<T>,
    ) {
        
    }

    get(id: string): Promise<T | undefined> {
        const existing = this.tracker.get(id);
        if (existing) { return Promise.resolve(existing); }
        return this.applySingleSelector(this.commonReadOnlyDao.singleSelector(id));
    }    
    getAll(): Promise<T[]> {
        return this.applyManySelector(this.commonReadOnlyDao.manySelector());
    }

    async applySingleSelector(selector: SingleSelector<T>): Promise<T | undefined> {
        const e = await selector();
        return this.tracker.attachIf(e);
    }
    async applyManySelector(selector: ManySelector<T>): Promise<T[]> {
        const entities = await selector();
        for (const e of entities) {
            this.tracker.attach(e);
        }
        return entities;
    }
}

export abstract class Repository<T extends Entity> extends ReadOnlyRepository<T> {

    constructor(
        commonDao: IDao<T>,
        private changeTracker: ChangeTracker<T>,
    ) {
        super(commonDao, changeTracker);
    }

    add(entity: T): void {
        this.changeTracker.insert(entity);
    }
    remove(entity: T): void {
        this.changeTracker.delete(entity);
    }
}
